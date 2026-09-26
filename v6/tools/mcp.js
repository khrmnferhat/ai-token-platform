'use strict';

const { validateInput } = require('./validation');
const { normalizeAdapterResult, withTimeout } = require('./router');
const { canUse } = require('./permissions');
const normalize = (value) => String(value || '').trim();
class McpAdapter {
  constructor({ server, transport, registry, allowedCapabilities, timeoutMs = 15000 } = {}) {
    if (!transport || typeof transport.listTools !== 'function' || typeof transport.callTool !== 'function') throw Object.assign(new Error('MCP transport must support listTools and callTool'), { code: 'INVALID_MCP_TRANSPORT' });
    this.server = { id: normalize(server?.id || server?.name || 'mcp'), name: normalize(server?.name || server?.id || 'mcp') };
    this.transport = transport;
    this.registry = registry;
    this.allowedCapabilities = allowedCapabilities;
    this.timeoutMs = timeoutMs;
    this.cache = new Map();
  }
  async discover() {
    const response = await this.transport.listTools();
    const tools = Array.isArray(response) ? response : response?.tools;
    if (!Array.isArray(tools)) throw Object.assign(new Error('MCP discovery returned malformed tools'), { code: 'MCP_DISCOVERY_FAILED' });
    const registered = [];
    for (const descriptor of tools) {
      const name = normalize(descriptor?.name);
      if (!name) continue;
      const tool = { name: `mcp_${this.server.id}_${name}`.toLowerCase(), description: descriptor.description || 'MCP tool', inputSchema: descriptor.inputSchema || descriptor.input_schema || { type: 'object', properties: {}, additionalProperties: false }, capabilities: Array.isArray(descriptor.capabilities) && descriptor.capabilities.length ? descriptor.capabilities : ['external'], source: 'mcp', enabled: descriptor.enabled !== false, execute: async (input, context) => this.call(name, input, context) };
      if (this.registry.has(tool.name)) continue;
      this.registry.register(tool); registered.push(this.registry.get(tool.name));
      this.cache.set(name, tool.name);
    }
    return registered.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema, capabilities: tool.capabilities, source: tool.source, enabled: tool.enabled }));
  }
  async call(name, input = {}, context = {}) {
    const registeredName = this.cache.get(name) || `mcp_${this.server.id}_${name}`.toLowerCase();
    const tool = this.registry.get(registeredName);
    if (!tool) return { ok: false, tool: registeredName, data: null, error: { code: 'MCP_TOOL_NOT_FOUND', message: 'MCP aracı bulunamadı.' }, metadata: { fetchedAt: new Date().toISOString() } };
    const validation = validateInput(input, tool.inputSchema);
    if (!validation.ok) return { ok: false, tool: tool.name, data: null, error: { code: 'INVALID_TOOL_INPUT', message: 'MCP girdileri geçersiz.' }, metadata: { fetchedAt: new Date().toISOString() } };
    if (!canUse(tool, context.capability, this.allowedCapabilities)) return { ok: false, tool: tool.name, data: null, error: { code: 'TOOL_PERMISSION_DENIED', message: 'MCP aracı için izin yok.' }, metadata: { fetchedAt: new Date().toISOString() } };
    try {
      const raw = await withTimeout(() => this.transport.callTool({ server: this.server.name, tool: name, arguments: input }), this.timeoutMs);
      return normalizeAdapterResult(tool, { ok: raw?.isError !== true, data: raw?.content ?? raw?.data ?? raw, source: 'mcp' }, Date.now() - (context.startedAt || Date.now()));
    } catch (error) { const code = error?.code === 'TIMEOUT' ? 'TIMEOUT' : 'MCP_FAILURE'; return { ok: false, tool: tool.name, data: null, error: { code, message: code === 'TIMEOUT' ? 'MCP aracı zaman aşımına uğradı.' : 'MCP aracı çalıştırılamadı.' }, metadata: { fetchedAt: new Date().toISOString() } }; }
  }
}
module.exports = { McpAdapter };

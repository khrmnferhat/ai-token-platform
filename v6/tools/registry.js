'use strict';

function normalizeName(value) { return String(value || '').trim().toLowerCase(); }
function safeMetadata(tool) {
  return tool ? {
    name: tool.name,
    description: tool.description || '',
    inputSchema: tool.inputSchema || { type: 'object', properties: {}, additionalProperties: false },
    capabilities: Array.isArray(tool.capabilities) ? [...tool.capabilities] : [],
    source: tool.source || 'native',
    enabled: tool.enabled !== false
  } : null;
}

class ToolRegistry {
  constructor() { this.tools = new Map(); }
  register(tool) {
    const name = normalizeName(tool?.name);
    if (!name) throw Object.assign(new Error('Tool name is required'), { code: 'INVALID_TOOL' });
    if (this.tools.has(name)) throw Object.assign(new Error(`Tool already registered: ${name}`), { code: 'DUPLICATE_TOOL' });
    if (typeof tool.execute !== 'function') throw Object.assign(new Error('Tool execute is required'), { code: 'INVALID_TOOL' });
    const normalized = { ...tool, name, enabled: tool.enabled !== false, capabilities: Array.isArray(tool.capabilities) ? [...new Set(tool.capabilities.map(String))] : [] };
    this.tools.set(name, normalized);
    return safeMetadata(normalized);
  }
  unregister(name) { return this.tools.delete(normalizeName(name)); }
  get(name) { return this.tools.get(normalizeName(name)) || null; }
  has(name) { return this.tools.has(normalizeName(name)); }
  list() { return [...this.tools.values()].map(safeMetadata); }
  findByCapability(capability) { const key = normalizeName(capability); return [...this.tools.values()].filter((tool) => tool.capabilities.includes(key)).map(safeMetadata); }
  clear() { this.tools.clear(); }
}

module.exports = { ToolRegistry, safeMetadata, normalizeName };

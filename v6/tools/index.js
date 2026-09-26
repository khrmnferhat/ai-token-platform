'use strict';

const { ToolRegistry } = require('./registry');
const { ToolRouter } = require('./router');
const { McpAdapter } = require('./mcp');
const { createBuiltinRegistry } = require('./builtin');

function createToolLayer(options = {}) {
  const registry = options.registry || createBuiltinRegistry();
  const router = new ToolRouter(registry, options);
  const adapters = new Map();
  return {
    registry,
    router,
    addMcpAdapter(adapter) { if (!(adapter instanceof McpAdapter)) throw Object.assign(new Error('Invalid MCP adapter'), { code: 'INVALID_MCP_ADAPTER' }); adapters.set(adapter.server.id, adapter); return adapter; },
    getMcpAdapter(id) { return adapters.get(String(id || '').toLowerCase()) || null; },
    listMcpAdapters() { return [...adapters.values()].map((adapter) => ({ id: adapter.server.id, name: adapter.server.name, source: 'mcp' })); },
    async discoverMcp(id) { const adapter = this.getMcpAdapter(id); if (!adapter) return []; return adapter.discover(); }
  };
}
module.exports = { createToolLayer, ToolRegistry, ToolRouter, McpAdapter };

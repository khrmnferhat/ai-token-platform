'use strict';

const assert = require('node:assert/strict');
const { ToolRegistry } = require('../tools/registry');
const { ToolRouter } = require('../tools/router');
const { createToolLayer } = require('../tools');
const { McpAdapter } = require('../tools/mcp');

async function main() {
  const registry = new ToolRegistry();
  const schema = { type: 'object', properties: { value: { type: 'string', minLength: 1 } }, required: ['value'], additionalProperties: false };
  const tool = { name: 'demo', description: 'Demo', inputSchema: schema, capabilities: ['read', 'external'], source: 'test', enabled: true, execute: async ({ value }) => ({ ok: true, data: { value }, source: 'test' }) };
  assert.equal(registry.register(tool).name, 'demo');
  assert.equal(registry.has('DEMO'), true);
  assert.deepEqual(registry.findByCapability('read').map((item) => item.name), ['demo']);
  assert.throws(() => registry.register(tool), (error) => error.code === 'DUPLICATE_TOOL');
  const router = new ToolRouter(registry, { defaultTimeoutMs: 100 });
  const success = await router.execute('demo', { value: 'ok' }, { capability: 'read' });
  assert.equal(success.ok, true);
  assert.equal(success.data.value, 'ok');
  assert.equal(success.metadata.source, 'test');
  const unknown = await router.execute('missing', {});
  assert.equal(unknown.error.code, 'TOOL_NOT_FOUND');
  const invalid = await router.execute('demo', { value: '' }, { capability: 'read' });
  assert.equal(invalid.error.code, 'INVALID_TOOL_INPUT');
  const denied = await router.execute('demo', { value: 'x' }, { capability: 'read', allowedCapabilities: ['search'] });
  assert.equal(denied.error.code, 'TOOL_PERMISSION_DENIED');
  registry.get('demo').enabled = false;
  const disabled = await router.execute('demo', { value: 'x' }, { capability: 'read' });
  assert.equal(disabled.error.code, 'TOOL_DISABLED');
  const slow = { ...tool, name: 'slow', execute: async () => new Promise((resolve) => setTimeout(() => resolve({ ok: true, data: 'late' }), 100)) };
  const slowRegistry = new ToolRegistry(); slowRegistry.register(slow);
  const timeout = await new ToolRouter(slowRegistry, { defaultTimeoutMs: 5 }).execute('slow', { value: 'x' }, { capability: 'read' });
  assert.equal(timeout.error.code, 'TIMEOUT');
  assert.doesNotMatch(JSON.stringify(timeout), /stack|at async/i);
  const malformedRegistry = new ToolRegistry(); malformedRegistry.register({ ...tool, name: 'malformed', execute: async () => 'bad' });
  const malformed = await new ToolRouter(malformedRegistry).execute('malformed', { value: 'x' }, { capability: 'read' });
  assert.equal(malformed.error.code, 'MALFORMED_TOOL_RESULT');

  const mcpRegistry = new ToolRegistry();
  const transport = {
    calls: [],
    async listTools() { return { tools: [{ name: 'lookup', description: 'MCP lookup', inputSchema: { type: 'object', properties: { id: { type: 'string', minLength: 1 } }, required: ['id'], additionalProperties: false } }] }; },
    async callTool(request) { this.calls.push(request); return { content: [{ type: 'text', text: 'MCP sonucu' }] }; }
  };
  const mcp = new McpAdapter({ server: { id: 'demo', name: 'demo' }, transport, registry: mcpRegistry });
  const discovered = await mcp.discover();
  assert.equal(discovered.length, 1);
  assert.equal(discovered[0].source, 'mcp');
  const mcpResult = await new ToolRouter(mcpRegistry).execute('mcp_demo_lookup', { id: '7' }, { capability: 'external' });
  assert.equal(mcpResult.ok, true);
  assert.equal(transport.calls.length, 1);
  const mcpInvalid = await new ToolRouter(mcpRegistry).execute('mcp_demo_lookup', { id: '' }, { capability: 'external' });
  assert.equal(mcpInvalid.error.code, 'INVALID_TOOL_INPUT');
  const failing = await mcp.call('missing', {});
  assert.equal(failing.error.code, 'MCP_TOOL_NOT_FOUND');
  assert.equal(registry.unregister('DEMO'), true);
  assert.equal(registry.has('demo'), false);
  console.log('PASS: universal tool registry/router/permissions/timeout/MCP adapter');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });

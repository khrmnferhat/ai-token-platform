'use strict';

const assert = require('node:assert/strict');
const { ToolRegistry } = require('../tools/registry');
const { ToolRouter } = require('../tools/router');
const { McpAdapter } = require('../tools/mcp');

async function main() {
  const registry = new ToolRegistry();
  const transport = {
    async listTools() { return { tools: [{ name: 'echo', description: 'Echo', inputSchema: { type: 'object', properties: { text: { type: 'string', minLength: 1 } }, required: ['text'], additionalProperties: false } }] }; },
    async callTool({ arguments: input }) { if (input.text === 'fail') throw new Error('secret raw stack should not leak'); return { content: [{ type: 'text', text: input.text }] }; }
  };
  const adapter = new McpAdapter({ server: { id: 'local', name: 'local' }, transport, registry });
  const discovered = await adapter.discover();
  assert.equal(discovered.length, 1);
  assert.equal(discovered[0].name, 'mcp_local_echo');
  const router = new ToolRouter(registry);
  const ok = await router.execute('mcp_local_echo', { text: 'hello' }, { capability: 'external' });
  assert.equal(ok.ok, true);
  assert.equal(ok.metadata.source, 'mcp');
  const invalid = await router.execute('mcp_local_echo', { text: '' }, { capability: 'external' });
  assert.equal(invalid.error.code, 'INVALID_TOOL_INPUT');
  const failure = await router.execute('mcp_local_echo', { text: 'fail' }, { capability: 'external' });
  assert.equal(failure.ok, false);
  assert.equal(failure.error.code, 'MCP_FAILURE');
  assert.doesNotMatch(JSON.stringify(failure), /secret raw stack|Error:/);
  console.log('PASS: MCP discovery/schema/normalized execution/failure security');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });

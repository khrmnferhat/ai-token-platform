'use strict';

const { weather } = require('./weather');
const { currency } = require('./web');
const { runResearch } = require('../reasoning/research');

const objectSchema = (properties, required = [], additionalProperties = false) => ({ type: 'object', properties, required, additionalProperties });
const weatherTool = {
  name: 'weather',
  description: 'Bir şehir için hava durumu bilgisi alır.',
  inputSchema: objectSchema({ city: { type: 'string', minLength: 1, maxLength: 100 }, period: { type: 'string', enum: ['today', 'tomorrow', 'weekend'] } }, ['city']),
  capabilities: ['weather', 'read', 'external'],
  source: 'Open-Meteo',
  enabled: true,
  execute: async ({ city, period }) => { const result = await weather({ city, period }); return { ok: result.ok === true, data: result, source: result.source || 'Open-Meteo', ...(result.ok ? {} : { error: result.error, detail: result.detail }) }; }
};
const currencyTool = {
  name: 'currency',
  description: 'İki para birimi arasındaki güncel kuru alır.',
  inputSchema: objectSchema({ base: { type: 'string', minLength: 3, maxLength: 3, pattern: '^[A-Za-z]{3}$' }, quote: { type: 'string', minLength: 3, maxLength: 3, pattern: '^[A-Za-z]{3}$' } }, ['base', 'quote']),
  capabilities: ['currency', 'read', 'external'],
  source: 'Frankfurter / ECB',
  enabled: true,
  execute: async ({ base, quote }) => { const result = await currency({ base, quote }); return { ok: result.ok === true, data: result, source: result.source || 'Frankfurter / ECB', ...(result.ok ? {} : { error: result.error, detail: result.detail }) }; }
};
const researchTool = {
  name: 'research',
  description: 'Çok kaynaklı web araştırması yapar ve kanıtları sentezler.',
  inputSchema: objectSchema({ query: { type: 'string', minLength: 2, maxLength: 1000 }, plan: { type: 'object' } }, ['query']),
  capabilities: ['research', 'search', 'external'],
  source: 'Sardis Research Pipeline',
  enabled: true,
  execute: async ({ query, plan }) => {
    const result = await runResearch({ query, plan, limit: plan?.depth === 'quick' ? 2 : plan?.depth === 'deep' ? 6 : 4 });
    return result.completed ? { ok: true, data: result, source: 'Sardis Research Pipeline' } : { ok: false, error: 'NO_RELIABLE_EVIDENCE', detail: result.answer, data: result, source: 'Sardis Research Pipeline' };
  }
};
function createBuiltinRegistry() {
  const { ToolRegistry } = require('./registry');
  const registry = new ToolRegistry();
  [weatherTool, currencyTool, researchTool].forEach((tool) => registry.register(tool));
  return registry;
}
module.exports = { weatherTool, currencyTool, researchTool, createBuiltinRegistry };

'use strict';

const assert = require('node:assert/strict');
const baseUrl = String(process.env.V6_URL || 'http://127.0.0.1:3071').replace(/\/+$/, '');
async function request(path, options = {}) { const response = await fetch(`${baseUrl}${path}`, { ...options, signal: AbortSignal.timeout(180000) }); const raw = await response.text(); if (!response.ok) throw new Error(`${response.status}: ${raw}`); return raw; }
async function chat(sessionId, message) { const raw = await request('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId, message }) }); const events = raw.split('\n').filter(Boolean).map((line) => JSON.parse(line)); const done = events.find((event) => event.type === 'done'); assert.ok(done, raw); assert.ok(events.some((event) => event.type === 'delta'), raw); return done; }
async function main() {
  const discovery = JSON.parse(await request('/api/tools'));
  assert.deepEqual(discovery.tools.map((item) => item.name).sort(), ['currency', 'research', 'weather']);
  assert.ok(discovery.tools.every((item) => item.inputSchema && item.source && !('execute' in item)));
  const session = `http-tools-${Date.now()}`;
  const weather = await chat(session, "Gaziantep'te hava nasıl?");
  assert.equal(weather.route, 'weather');
  assert.equal(weather.tool, 'weather');
  assert.equal(weather.toolExecution.name, 'weather');
  assert.ok(weather.toolResult);
  assert.ok(weather.verification);
  const tomorrow = await chat(session, 'Yarın?');
  assert.equal(tomorrow.route, 'weather');
  assert.equal(tomorrow.context.weatherCity, 'Gaziantep');
  const currency = await chat(`currency-${Date.now()}`, 'Euro kuru bugün kaç?');
  assert.equal(currency.route, 'currency');
  assert.equal(currency.tool, 'currency');
  assert.equal(currency.toolExecution.name, 'currency');
  const researchSession = `research-${Date.now()}`;
  const research = await chat(researchSession, 'Bitcoin hakkında araştırma yap.');
  assert.equal(research.route, 'research');
  assert.equal(research.tool, 'web_research');
  assert.equal(research.toolExecution.name, 'research');
  assert.ok(Array.isArray(research.sources));
  assert.ok(Array.isArray(research.claims));
  assert.ok(Array.isArray(research.evidence));
  assert.ok(research.research);
  const followUp = await chat(researchSession, 'Bunu biraz daha derinleştir.');
  assert.equal(followUp.route, 'research');
  assert.equal(followUp.reasoning.isFollowUp, true);
  const health = JSON.parse(await request('/api/health'));
  assert.deepEqual(health.tools, ['chat', 'weather', 'research', 'currency', 'memory']);
  assert.equal(health.toolMetadata.length, 3);
  console.log('PASS: live HTTP universal tool registry/router/weather/currency/research/follow-up/streaming');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });

'use strict';

const assert = require('node:assert/strict');
const baseUrl = String(process.env.V6_URL || 'http://127.0.0.1:3069').replace(/\/+$/, '');

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, { ...options, signal: AbortSignal.timeout(180000) });
  const raw = await response.text();
  if (!response.ok) throw new Error(`${response.status}: ${raw}`);
  return raw;
}
async function chat(sessionId, message) {
  const raw = await request('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId, message }) });
  const events = raw.split('\n').filter(Boolean).map((line) => JSON.parse(line));
  const done = events.find((event) => event.type === 'done');
  assert.ok(done, raw);
  assert.ok(events.some((event) => event.type === 'delta'), raw);
  return done;
}
async function main() {
  const direct = await chat('reasoning-direct', 'Merhaba');
  assert.equal(direct.route, 'chat');
  assert.equal(direct.reasoning.requiresResearch, false);
  const current = await chat('reasoning-current', 'Bitcoin bugün kaç dolar?');
  assert.equal(current.route, 'research');
  assert.equal(current.reasoning.taskType, 'research');
  const explicit = await chat('reasoning-explicit', 'Türkiye elektrikli araç piyasasını detaylı araştır.');
  assert.equal(explicit.route, 'research');
  assert.equal(explicit.reasoning.researchDepth, 'deep');
  assert.ok(Array.isArray(explicit.sources));
  assert.ok(Array.isArray(explicit.claims));
  const followUp = await chat('reasoning-explicit', 'Bunu detaylı araştır.');
  assert.equal(followUp.route, 'research');
  assert.equal(followUp.reasoning.isFollowUp, true);
  const comparison = await chat('reasoning-comparison', 'iPhone ile Samsung karşılaştır');
  assert.equal(comparison.route, 'research');
  assert.equal(comparison.reasoning.answerMode, 'compare');
  const memoryAware = await chat('reasoning-memory', 'Gaziantep\'te bugün en iyi kahvaltı yerleri hangileri?');
  assert.equal(memoryAware.route, 'research');
  assert.ok(Array.isArray(memoryAware.sources));
  const health = JSON.parse(await request('/api/health'));
  assert.equal(health.ok, true);
  console.log('PASS: live HTTP reasoning/research/follow-up/comparison/memory-aware/streaming');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });

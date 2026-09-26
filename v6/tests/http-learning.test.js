'use strict';

const assert = require('node:assert/strict');
const baseUrl = String(process.env.V6_URL || 'http://127.0.0.1:3072').replace(/\/+$/, '');
async function request(path, options = {}) { const response = await fetch(`${baseUrl}${path}`, { ...options, signal: AbortSignal.timeout(180000) }); const raw = await response.text(); if (!response.ok) throw new Error(`${response.status}: ${raw}`); return raw; }
async function chat(sessionId, message) { const raw = await request('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId, message }) }); const events = raw.split('\n').filter(Boolean).map((line) => JSON.parse(line)); const done = events.find((event) => event.type === 'done'); assert.ok(done, raw); assert.ok(events.some((event) => event.type === 'delta'), raw); assert.ok(done.experience, raw); assert.ok(done.learning, raw); assert.ok(done.learning.event, raw); return done; }
async function main() {
  const session = `http-learning-${Date.now()}`;
  const first = await chat(session, 'Merhaba');
  assert.equal(first.learning.applied, false);
  const repeated = await chat(session, 'Merhaba');
  assert.ok(repeated.learning.confidence >= 0);
  const weather = await chat(session, "Gaziantep'te hava nasıl?");
  assert.equal(weather.route, 'weather');
  assert.equal(weather.learning.event.type, 'lesson_candidate');
  const followUp = await chat(session, 'Yarın?');
  assert.equal(followUp.route, 'weather');
  assert.ok(followUp.learning);
  const researchSession = `http-learning-research-${Date.now()}`;
  const research = await chat(researchSession, 'Bitcoin hakkında araştırma yap.');
  assert.equal(research.route, 'research');
  assert.ok(research.research);
  const researchFollow = await chat(researchSession, 'Bunu biraz daha derinleştir.');
  assert.equal(researchFollow.reasoning.isFollowUp, true);
  const correction = await chat(`http-learning-correction-${Date.now()}`, 'Hayır, artık kısa cevapları tercih ediyorum.');
  assert.ok(correction.learning.confidence >= 0.6);
  const memory = await chat(`http-learning-memory-${Date.now()}`, 'Benim adım Ferhat. Bunu hatırla.');
  assert.equal(memory.route, 'memory');
  const recall = await chat(`http-learning-recall-${Date.now()}`, 'Benim adım ne?');
  assert.match(recall.answer, /Ferhat/);
  const health = JSON.parse(await request('/api/health'));
  assert.equal(health.ok, true);
  console.log('PASS: live HTTP controlled learning experience/retrieval/correction/memory/streaming');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });

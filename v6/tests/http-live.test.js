'use strict';

const assert = require('node:assert/strict');
const baseUrl = String(process.env.V6_URL || 'http://127.0.0.1:3060').replace(/\/+$/, '');
const messages = [
  'Hava çok güzel bugün.',
  'Peki yarın nasıl?',
  'Hafta sonu?',
  "Gaziantep'te hava nasıl?",
  'Yarın?',
  'Euro kuru bugün kaç?',
  'Geçen konuştuğumuz projeyi hatırlıyor musun?',
  'Bunu hatırla.'
];
const expectedRoutes = ['chat', 'weather', 'weather', 'weather', 'weather', 'currency', 'chat', 'memory'];

async function json(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(150000) });
  const body = await response.json();
  if (!response.ok) throw new Error(`${response.status}: ${JSON.stringify(body)}`);
  return body;
}
function parseNdjson(text) { return text.split('\n').filter(Boolean).map((line) => JSON.parse(line)); }

async function main() {
  const session = await json(`${baseUrl}/api/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.ok(session.sessionId);
  const actualRoutes = [];
  for (let index = 0; index < messages.length; index += 1) {
    const response = await fetch(`${baseUrl}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: session.sessionId, message: messages[index] }), signal: AbortSignal.timeout(150000) });
    const raw = await response.text();
    assert.equal(response.status, 200, raw);
    const events = parseNdjson(raw);
    const done = events.find((event) => event.type === 'done');
    assert.ok(done, raw);
    assert.equal(done.sessionId, session.sessionId);
    assert.ok(done.intelligence, raw);
    assert.ok(done.verification, raw);
    assert.equal(done.verification.intent, done.intelligence.intent);
    actualRoutes.push(done.route);
    console.log(`${index + 1}. ${messages[index]} -> ${done.route}`);
  }
  assert.deepEqual(actualRoutes, expectedRoutes);
  const stored = await json(`${baseUrl}/api/session/${session.sessionId}`);
  assert.equal(stored.messages.length, messages.length * 2);
  assert.equal(stored.context.weatherCity, 'Gaziantep');
  assert.equal(stored.context.lastIntent, 'memory');
  console.log(`PASS: live API 8-message vertical slice (${actualRoutes.join(' -> ')})`);
  console.log(`session messages: ${stored.messages.length}; context: ${JSON.stringify(stored.context)}`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
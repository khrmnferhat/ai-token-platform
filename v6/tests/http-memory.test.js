'use strict';

const assert = require('node:assert/strict');
const baseUrl = String(process.env.V6_URL || 'http://127.0.0.1:3061').replace(/\/+$/, '');
async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, { ...options, signal: AbortSignal.timeout(180000) });
  const raw = await response.text();
  if (!response.ok) throw new Error(`${response.status}: ${raw}`);
  return raw;
}
async function chat(label, sessionId, message) {
  console.log(`step:${label}`);
  const raw = await request('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId, message }) });
  const events = raw.split('\n').filter(Boolean).map((line) => JSON.parse(line));
  const done = events.find((event) => event.type === 'done');
  assert.ok(done, raw);
  assert.ok(events.some((event) => event.type === 'delta'), raw);
  return done;
}
async function main() {
  console.log('step:create-session');
  const first = JSON.parse(await request('/api/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }));
  const named = await chat('name-memory', first.sessionId, 'Benim adım Ferhat. Bunu hatırla.');
  assert.equal(named.route, 'memory');
  assert.equal(named.identity.name, 'ferhat');
  const recall = await chat('name-recall', 'http-memory-new-session', 'Benim adım ne?');
  assert.match(recall.answer, /Ferhat/);
  const windows = await chat('windows-memory', first.sessionId, 'Windows 11 kullanıyorum. Bunu hatırla.');
  const duplicate = await chat('windows-duplicate', first.sessionId, 'Windows 11 kullanıyorum, bunu kaydet.');
  assert.equal(windows.fact.id, duplicate.fact.id);
  const ubuntu = await chat('ubuntu-memory', first.sessionId, 'Artık Ubuntu kullanıyorum. Bunu hatırla.');
  assert.notEqual(ubuntu.fact.id, windows.fact.id);
  const osRecall = await chat('os-recall', 'http-memory-os-session', 'Hangi işletim sistemini kullanıyorum?');
  assert.match(osRecall.answer, /Ubuntu/);
  const unrelated = await chat('weather-unrelated', 'http-memory-weather-session', 'Hava bugün nasıl?');
  assert.equal(unrelated.route, 'weather');
  assert.equal(unrelated.memory.retrieved.length, 0);
  const lesson = await chat('lesson', 'http-memory-lesson-session', 'Hayır, bunu yanlış anladın.');
  assert.equal(lesson.lesson.type, 'lesson');
  assert.equal(lesson.lesson.source, 'correction');
  const health = JSON.parse(await request('/api/health'));
  assert.equal(health.ok, true);
  assert.equal(typeof health.userIdentity, 'object');
  console.log('PASS: live HTTP multi-session memory/identity/experience/streaming');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });



'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Sardis } = require('../core/sardis');

const stateFile = path.join(os.tmpdir(), `sardis-v6-memory-${process.pid}.json`);
const sardis = new Sardis({ memoryFile: stateFile });
sardis.ollama = async () => 'Sardis hazır.';

async function main() {
  const named = await sardis.chat('memory-session-a', 'Benim adım Ferhat. Bunu hatırla.');
  assert.equal(named.route, 'memory');
  assert.equal(named.fact.content, 'Benim adım Ferhat');
  assert.equal(named.identity.name, 'ferhat');
  assert.equal(named.fact.confidence, 0.95);

  const recalled = await sardis.chat('memory-session-b', 'Benim adım ne?');
  assert.equal(recalled.route, 'chat');
  assert.match(recalled.answer, /Ferhat/);

  const windows = await sardis.chat('memory-session-c', 'Windows 11 kullanıyorum. Bunu hatırla.');
  const duplicate = await sardis.chat('memory-session-c', 'Windows 11 kullanıyorum, bunu kaydet.');
  assert.equal(windows.fact.id, duplicate.fact.id);
  assert.equal(sardis.memory.facts().filter((item) => /Windows 11/i.test(item.content)).length, 1);

  const ubuntu = await sardis.chat('memory-session-c', 'Artık Ubuntu kullanıyorum. Bunu hatırla.');
  assert.notEqual(ubuntu.fact.id, windows.fact.id);
  assert.ok(sardis.memory.memories().find((item) => item.id === windows.fact.id).validUntil);
  const osRecall = await sardis.chat('memory-session-d', 'Hangi işletim sistemini kullanıyorum?');
  assert.match(osRecall.answer, /Ubuntu/);
  assert.doesNotMatch(osRecall.answer, /Windows/);

  const unrelated = await sardis.chat('memory-session-e', 'Hava bugün nasıl?');
  assert.equal(unrelated.route, 'weather');
  assert.equal(unrelated.requiresClarification, true);
  assert.equal(unrelated.memory.retrieved.length, 0);

  const lesson = await sardis.chat('memory-session-f', 'Hayır, bunu yanlış anladın.');
  assert.equal(lesson.route, 'chat');
  assert.equal(lesson.lesson.type, 'lesson');
  assert.equal(lesson.lesson.source, 'correction');
  assert.equal(sardis.memory.lessons().length, 1);
  assert.equal(sardis.memory.experiences().length > 0, true);

  const noNameGuess = await sardis.chat('memory-session-g', 'Ben Gaziantep\'te çalışıyorum. Bunu hatırla.');
  assert.equal(noNameGuess.identity.name, 'ferhat');
  assert.equal(noNameGuess.fact.type, 'fact');

  const forget = await sardis.chat('memory-session-c', 'Windows 11\'i unutma.');
  assert.equal(forget.route, 'memory');
  assert.equal(forget.memory.operation, 'forget');
  assert.equal(sardis.memory.facts().some((item) => /Windows 11/i.test(item.content)), false);

  console.log('PASS: V6 memory identity experience regression');
  console.log(`facts=${sardis.memory.facts().length}; lessons=${sardis.memory.lessons().length}; experiences=${sardis.memory.experiences().length}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => fs.rmSync(stateFile, { force: true }));

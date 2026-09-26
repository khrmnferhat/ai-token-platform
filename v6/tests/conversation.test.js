'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Sardis } = require('../core/sardis');

const stateFile = path.join(os.tmpdir(), `sardis-v6-test-${process.pid}.json`);
const sardis = new Sardis({ memoryFile: stateFile });
sardis.ollama = async () => 'Güzel, seni dinliyorum.';
const sessionId = `test-${Date.now()}`;

async function main() {
  const first = await sardis.chat(sessionId, 'Hava çok güzel bugün.');
  assert.equal(first.route, 'chat');
  const second = await sardis.chat(sessionId, 'Peki yarın nasıl?');
  assert.equal(second.route, 'weather');
  const third = await sardis.chat(sessionId, 'Hafta sonu?');
  assert.equal(third.route, 'weather');
  const fourth = await sardis.chat(sessionId, "Gaziantep'te hava nasıl?");
  assert.equal(fourth.route, 'weather');
  const fifth = await sardis.chat(sessionId, 'Yarın?');
  assert.equal(fifth.route, 'weather');
  assert.equal(fifth.intelligence.topic, 'weather');
  assert.equal(fifth.intelligence.entities.city, 'Gaziantep');
  assert.equal(fifth.verification.intent, 'weather');
  assert.equal(fifth.context.weatherCity, 'Gaziantep');
  const sixth = await sardis.chat(sessionId, 'Euro kuru bugün kaç?');
  assert.equal(sixth.route, 'currency');
  const seventh = await sardis.chat(sessionId, 'Geçen konuştuğumuz projeyi hatırlıyor musun?');
  assert.equal(seventh.route, 'chat');
  const eighth = await sardis.chat(sessionId, 'Bunu hatırla.');
  assert.equal(eighth.route, 'memory');
  assert.ok(eighth.intelligence);
  assert.ok(eighth.verification);
  assert.equal(sardis.memory.facts().length > 0, true);
  assert.equal(sardis.session(sessionId).messages.length, 16);
  console.log('PASS: 8-message Sardis V6 vertical slice');
  console.log(`routes: ${[first, second, third, fourth, fifth, sixth, seventh, eighth].map((item) => item.route).join(' -> ')}`);
  console.log(`memory facts: ${sardis.memory.facts().length}`);
  fs.rmSync(stateFile, { force: true });
}

main().catch((error) => {
  console.error(error);
  fs.rmSync(stateFile, { force: true });
  process.exitCode = 1;
});

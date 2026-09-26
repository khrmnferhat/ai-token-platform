'use strict';

const assert = require('node:assert/strict');
const { classifyIntent } = require('../core/intent');
const { decide, legacyRoute } = require('../core/decision');
const { verifyResult } = require('../core/verifier');

function main() {
  const standalone = classifyIntent("Gaziantep'te hava nasıl?", {});
  assert.equal(standalone.intent, 'weather');
  assert.equal(standalone.requiresTool, true);
  assert.equal(standalone.entities.city, 'Gaziantep');
  assert.equal(standalone.continuation, false);
  assert.equal(decide(standalone).action, 'tool');
  assert.equal(legacyRoute(standalone).city, 'Gaziantep');

  const followUp = classifyIntent('Yarın?', { weatherCity: 'Gaziantep', weatherTopic: true });
  assert.equal(followUp.intent, 'weather');
  assert.equal(followUp.continuation, true);
  assert.equal(followUp.entities.city, 'Gaziantep');
  assert.equal(legacyRoute(followUp).city, 'Gaziantep');

  const missingCity = classifyIntent('Peki yarın nasıl?', { weatherTopic: true });
  assert.equal(missingCity.requiresClarification, true);
  assert.equal(decide(missingCity).action, 'clarify');

  const memoryRecall = classifyIntent('Geçen konuştuğumuz projeyi hatırlıyor musun?', {});
  assert.equal(memoryRecall.intent, 'memory');
  assert.equal(memoryRecall.requiresMemory, true);
  assert.equal(decide(memoryRecall).action, 'chat');

  const memoryAction = classifyIntent('Bunu hatırla.', {});
  assert.equal(memoryAction.memoryAction, true);
  assert.equal(decide(memoryAction).action, 'memory');

  const currency = classifyIntent('Euro kuru bugün kaç?', {});
  assert.equal(currency.intent, 'currency');
  assert.equal(decide(currency).tool, 'currency');

  const research = classifyIntent('Sardis V6 için güncel kaynak araştır.', {});
  assert.equal(research.intent, 'research');
  assert.equal(decide(research).tool, 'web_research');

  const verified = verifyResult({ answer: 'Tamam', tool: null }, standalone);
  assert.equal(verified.ok, true);
  assert.equal(verified.mode, 'response');
  assert.equal(verified.reason, 'answer_available');
  assert.equal(verified.intent, 'weather');
  assert.ok(verified.checkedAt);
  assert.equal(verifyResult({ answer: 'Hata', tool: 'weather', ok: false }, standalone).ok, false);
  assert.equal(verifyResult({ answer: 'Hangi şehir?', action: 'clarify' }, missingCity).ok, true);
  console.log('PASS: intelligence context/intent/decision/verifier');
}
main();

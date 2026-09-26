'use strict';

const assert = require('node:assert/strict');
const { planReasoning } = require('../reasoning/planner');
const { runResearch, findContradictions } = require('../reasoning/research');

async function main() {
  const direct = planReasoning('Merhaba', {}, {});
  assert.equal(direct.taskType, 'chat');
  assert.equal(direct.requiresResearch, false);
  const current = planReasoning('Bitcoin bugün kaç dolar?', {}, {});
  assert.equal(current.taskType, 'research');
  assert.equal(current.researchDepth, 'quick');
  const explicit = planReasoning('Türkiye elektrikli araç piyasasını detaylı araştır.', { intent: 'research' }, {});
  assert.equal(explicit.requiresResearch, true);
  assert.equal(explicit.answerMode, 'research');
  assert.ok(explicit.researchPlan.searchQueries.length >= 2);
  const comparison = planReasoning('iPhone ile Samsung karşılaştır', {}, {});
  assert.equal(comparison.taskType, 'comparison');
  assert.equal(comparison.answerMode, 'compare');
  const historical = planReasoning('2020 yılında konut fiyatları nasıldı?', {}, {});
  assert.equal(historical.isHistorical, true);
  const followUp = planReasoning('Bunu detaylı araştır.', {}, { researchTopic: 'Elektrikli araç pazarı' });
  assert.equal(followUp.isFollowUp, true);
  assert.equal(followUp.researchPlan.objective, 'Elektrikli araç pazarı');
  const purchase = planReasoning('Kahve makinesi alacağım.', {}, {});
  assert.equal(purchase.taskType, 'planning');
  assert.equal(purchase.answerMode, 'clarify');
  assert.ok(purchase.questions.length >= 2);

  const searchCalls = [];
  const result = await runResearch({
    query: 'Elektrikli araç pazarı',
    plan: { ...explicit.researchPlan, searchQueries: ['query one', 'query two'], memoryHints: ['Kullanıcı Gaziantep\'te yaşıyor'] },
    search: async ({ query }) => { searchCalls.push(query); return { ok: true, results: query === 'query one' ? [
      { title: 'Resmi pazar raporu', url: 'https://www.tuik.gov.tr/rapor', snippet: 'Pazar 2026 yılında büyüyor.' },
      { title: 'Teknik rapor', url: 'https://example.org/technical', snippet: 'Pazar 2026 yılında büyüyor.' }
    ] : [{ title: 'Haber raporu', url: 'https://www.reuters.com/market', snippet: 'Pazar 2026 yılında büyüyor.' }] }; },
    reader: async (item) => ({ ...item, read: true, evidence: `${item.snippet} Gaziantep yerel pazarı da değerlendirilmeli.`, retrievedAt: new Date().toISOString() })
  });
  assert.equal(searchCalls.length, 2);
  assert.equal(result.sources.length, 3);
  assert.ok(result.sources.every((item) => item.confidence > 0));
  assert.equal(result.completed, true);
  assert.equal(result.memoryContext[0], "Kullanıcı Gaziantep'te yaşıyor");
  assert.ok(result.claims.length >= 3);

  const conflict = findContradictions([
    { claim: 'Pazar 100 milyar TL büyüyor', source: 'a' },
    { claim: 'Pazar 120 milyar TL büyüyor', source: 'b' }
  ]);
  assert.equal(conflict.length, 1);
  const failed = await runResearch({ query: 'bulunmayan konu', search: async () => ({ ok: true, results: [] }), reader: async (item) => item });
  assert.equal(failed.completed, false);
  assert.deepEqual(failed.failed, ['no_reliable_sources']);
  assert.equal(failed.sources.length, 0);
  assert.match(failed.answer, /güvenilir kaynak bulamadım/);
  console.log('PASS: reasoning planner and research intelligence');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });

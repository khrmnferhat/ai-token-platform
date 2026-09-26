'use strict';

const { research: legacySearch } = require('../tools/web');
const { quality, readCandidate } = require('./source-quality');
const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
const lower = (value) => clean(value).toLocaleLowerCase('tr-TR');
function claimFrom(item, query) {
  const evidence = clean(item.evidence || item.snippet);
  if (!evidence) return null;
  return { claim: evidence.slice(0, 500), evidence, source: item.url, sourceType: item.sourceType, publishedAt: item.publishedAt || null, retrievedAt: item.retrievedAt || new Date().toISOString(), confidence: item.confidence || 0.45, query };
}
function numericValues(value) { return [...String(value || '').matchAll(/\b\d+(?:[.,]\d+)?\s*(?:%|tl|usd|eur|milyar|milyon|bin)?\b/gi)].map((match) => match[0].toLocaleLowerCase('tr-TR')); }
function findContradictions(claims) {
  const groups = new Map();
  for (const claim of claims || []) {
    const key = lower(claim.claim).replace(/\d+(?:[.,]\d+)?\s*(?:%|tl|usd|eur|milyar|milyon|bin)?/gi, '').replace(/\s+/g, ' ').trim().slice(0, 100);
    if (!key || !numericValues(claim.claim).length) continue;
    groups.set(key, [...(groups.get(key) || []), claim]);
  }
  return [...groups.entries()].filter(([, items]) => new Set(items.flatMap((item) => numericValues(item.claim))).size > 1).map(([topic, items]) => ({ topic, claims: items, values: [...new Set(items.flatMap((item) => numericValues(item.claim)))] }));
}
function synthesize(research) {
  if (!research.sources.length) return 'Bu konuda güvenilir kaynak bulamadım; kesin bir sonuç üretmek için doğrulama yapılamadı.';
  if (research.contradictions.length) return `Kaynaklar farklı bilgiler veriyor. ${research.claims.slice(0, 2).map((item) => item.claim).join(' | ')} Bu nedenle sonucu tek bir değer olarak kesinleştiremiyorum.`;
  return `${research.claims.slice(0, 3).map((item) => item.claim).join(' ')} Kaynaklara göre konunun ana boyutları bu şekilde öne çıkıyor.`;
}
async function runResearch({ query, plan, search = legacySearch, reader = readCandidate, limit = 4 } = {}) {
  const cleanQuery = clean(query);
  const queries = plan?.searchQueries?.length ? plan.searchQueries : [cleanQuery];
  const results = [];
  for (const searchQuery of queries.slice(0, plan?.depth === 'deep' ? 3 : 2)) {
    try {
      const found = await search({ query: searchQuery });
      if (found?.ok !== false) results.push(...(found?.results || []).map((item) => ({ ...item, query: searchQuery })));
    } catch (error) { results.push({ error: String(error.message || error), query: searchQuery }); }
  }
  const byUrl = new Map();
  results.filter((item) => item?.url && item?.title).forEach((item, index) => { if (!byUrl.has(item.url)) byUrl.set(item.url, quality(item, item.query || cleanQuery, index)); });
  const selected = [...byUrl.values()].sort((left, right) => right.confidence - left.confidence).slice(0, Math.max(1, Math.min(limit, plan?.depth === 'quick' ? 2 : plan?.depth === 'deep' ? 6 : 4)));
  const read = await Promise.all(selected.map((item) => reader(item)));
  const sources = read.map((item) => ({ url: item.url, title: item.title, sourceType: item.sourceType, authority: item.authority, relevance: item.relevance, freshness: item.freshness, confidence: item.confidence, read: item.read, evidence: item.evidence || item.snippet || '', readError: item.readError || null }));
  const claims = sources.map((item) => claimFrom(item, cleanQuery)).filter(Boolean);
  const evidence = claims;
  const output = { memoryContext: plan?.memoryHints || [], objective: plan?.objective || cleanQuery, sources, claims, evidence, contradictions: findContradictions(claims), confidence: sources.length ? Number((sources.reduce((sum, item) => sum + item.confidence, 0) / sources.length).toFixed(3)) : 0, completed: sources.length > 0 && claims.length > 0, failed: sources.length ? [] : ['no_reliable_sources'] };
  output.answer = synthesize(output);
  return output;
}
module.exports = { runResearch, findContradictions, synthesize, claimFrom };

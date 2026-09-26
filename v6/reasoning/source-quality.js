'use strict';

const { URL } = require('node:url');
const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
const lower = (value) => clean(value).toLocaleLowerCase('tr-TR');
const currentYear = new Date().getUTCFullYear();
const TYPES = [
  { pattern: /(?:^|\.)gov(?:\.[a-z]{2})?$|(?:^|\.)gov\./i, type: 'official_government', authority: 0.98 },
  { pattern: /(?:^|\.)edu(?:\.[a-z]{2})?$|(?:^|\.)edu\./i, type: 'academic', authority: 0.9 },
  { pattern: /(?:^|\.)int$/i, type: 'recognized_institution', authority: 0.88 },
  { pattern: /(?:^|\.)(?:apple|samsung|microsoft|google)\.com$/i, type: 'official_company', authority: 0.96 },
  { pattern: /(?:^|\.)(?:reuters|apnews|bbc|nytimes)\.com$/i, type: 'reputable_publication', authority: 0.82 }
];
function sourceType(url = '', title = '') {
  let host = '';
  try { host = new URL(url).hostname; } catch {}
  return TYPES.find((item) => item.pattern.test(host)) || (/developer|docs?\.|documentation/i.test(`${host} ${title}`) ? { type: 'technical', authority: 0.78 } : /news|haber|rapor|report|analysis/i.test(title) ? { type: 'news_report', authority: 0.68 } : /price|fiyat|market|piyasa|stock|borsa/i.test(`${host} ${title}`) ? { type: 'market_data', authority: 0.64 } : { type: 'web', authority: 0.45 });
}
function quality(item, query, index) {
  const type = sourceType(item.url, item.title);
  const queryTokens = new Set(lower(query).split(/\s+/).filter((token) => token.length > 2));
  const titleTokens = new Set(lower(`${item.title || ''} ${item.snippet || ''}`).split(/\s+/));
  const relevance = Math.min(1, [...queryTokens].filter((token) => titleTokens.has(token)).length / Math.max(1, queryTokens.size));
  const freshness = new RegExp(`\\b${currentYear - 1}|\\b${currentYear}\\b`).test(`${item.title || ''} ${item.snippet || ''}`) ? 0.9 : 0.55;
  const specificity = Math.min(1, ((item.snippet || '').length / 180) * 0.5 + (item.title || '').length / 160);
  const confidence = Number((type.authority * 0.4 + relevance * 0.3 + freshness * 0.15 + specificity * 0.15).toFixed(3));
  return { ...item, sourceType: type.type, authority: type.authority, relevance, freshness, specificity, confidence, sourceIndex: index };
}
async function readCandidate(item, timeoutMs = 7000) {
  if (!item?.url) return { ...item, read: false, evidence: '' };
  try {
    const response = await fetch(item.url, { headers: { 'user-agent': 'Sardis/6 evidence reader' }, signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' });
    const type = response.headers.get('content-type') || '';
    if (!response.ok || !/text\/html|text\/plain/i.test(type)) return { ...item, read: false, evidence: item.snippet || '', readError: `HTTP ${response.status}` };
    const raw = await response.text();
    const evidence = raw.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/gi, ' ').replace(/\s+/g, ' ').trim().slice(0, 1200);
    return { ...item, read: true, evidence, retrievedAt: new Date().toISOString() };
  } catch (error) {
    return { ...item, read: false, evidence: item.snippet || '', readError: String(error.message || error) };
  }
}
module.exports = { sourceType, quality, readCandidate };

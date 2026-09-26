'use strict';

const STOP_WORDS = new Set([
  'acik', 'benim', 'bende', 'ben', 'bu', 'bunu', 'bir', 'da', 'de', 'diye', 'dolayi', 'en', 'gibi', 'hangi',
  'hatirladigim', 'hatirladiklarim', 'hatirlar', 'hatirliyor', 'hatirlayabilir', 'icer', 'idi', 'ilgili', 'isim',
  'kadar', 'mi', 'mu', 'ne', 'nedir', 'neydi', 'once', 'oper', 'sistem', 'sistemi', 'sonra', 'unut', 'var', 've',
  'what', 'which', 'my', 'i', 'do', 'you', 'use', 'used', 'using', 'to', 'was', 'the', 'is', 'are'
]);
function fold(value) {
  return String(value || '').toLocaleLowerCase('tr-TR').replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ş/g, 's').replace(/ü/g, 'u').replace(/[^a-z0-9]+/gi, ' ').trim();
}
function normalized(value) { return fold(value).replace(/\s+/g, ' ').trim(); }
function tokens(value) {
  const result = [];
  for (const raw of normalized(value).split(' ')) {
    if (!raw || STOP_WORDS.has(raw) || raw.length < 2) continue;
    const token = raw.replace(/ler$|lar$/u, '').replace(/ini$|inı$|unı$/u, 'in').replace(/mum$|misin$/u, 'mu');
    if (token && !STOP_WORDS.has(token)) result.push(token);
  }
  return result;
}
function operatingSystemValue(content) {
  const value = String(content || '');
  const known = value.match(/\b(Windows(?:\s+(?:10|11|Server)?(?:\s+(?:Pro|Home|Enterprise))?)|Ubuntu(?:\s+[\d.]+)?|Linux(?:\s+[A-Za-z0-9.+-]+)?|macOS(?:\s+[\d.]+)?|Android(?:\s+[\d.]+)?|iOS(?:\s+[\d.]+)?)\b/iu);
  if (known) return normalized(known[1]);
  const labelled = value.match(/(?:ana\s+)?işletim\s+sistem(?:im|imi|imi)?\s*(?:olarak)?\s*[:\-]?\s*([^.;,!?]+)/iu);
  return labelled ? normalized(labelled[1]) : null;
}
function detectSubject(content) {
  const value = String(content || '').trim();
  const name = value.match(/^(?:(?:artık|simdi)\s+)?(?:benim\s+)?ad(?:ı|i)m(?:iz)?\s*(?:[:\-]\s*)?([A-Za-zÇĞİÖŞÜçğıöşü][A-Za-zÇĞİÖŞÜçğıöşü'’ -]{1,60})/iu);
  if (name && !/^(ne|kim|what|who)$/iu.test(normalized(name[1]))) return { key: 'name', label: 'ad', value: normalized(name[1]) };
  const os = operatingSystemValue(value);
  if (os && /(işletim|windows|ubuntu|linux|macos|android|\bios\b|artık\s+\w+\s+kullanıyorum)/iu.test(value)) return { key: 'operating_system', label: 'işletim sistemi', value: os };
  if (/işletim\s+sistem|operating\s+system|\bos\b/iu.test(value)) return { key: 'operating_system', label: 'işletim sistemi', value: null };
  const location = value.match(/(?:ben\s+)?([A-ZÇĞİÖŞÜ][A-Za-zÇĞİÖŞÜçğıöşü'’-]+)\s*['’](?:te|ta|de|da)\s+(?:yaşıyorum|oturuyorum)/u);
  if (location) return { key: 'location', label: 'konum', value: normalized(location[1]) };
  return null;
}
function isCurrent(record, now = new Date()) {
  const current = now.getTime();
  const from = Date.parse(record.validFrom || record.createdAt || '') || 0;
  const until = record.validUntil ? Date.parse(record.validUntil) : Infinity;
  return from <= current && current < until;
}
function typeRelevance(record, query) {
  const value = fold(query);
  if (/tercih|seviyor|beğen|prefer|like/.test(value) && record.type === 'preference') return 0.35;
  if (/deneyim|geçmiş|experience|başarılı|başarisiz/.test(value) && record.type === 'experience') return 0.35;
  if (/ad|isim|name/.test(value) && detectSubject(record.content)?.key === 'name') return 0.35;
  if (/işletim|operating|\bos\b/.test(value) && detectSubject(record.content)?.key === 'operating_system') return 0.35;
  if (/fact|gerçek|bilgi/.test(value) && record.type === 'fact') return 0.12;
  return 0;
}
function scoreRecord(record, query, now = new Date()) {
  const recordTokens = new Set(tokens(record.content));
  const queryTokens = [...new Set(tokens(query))];
  const querySubject = detectSubject(query);
  const recordSubject = detectSubject(record.content);
  if (!queryTokens.length || !recordTokens.size) return 0;
  const matches = queryTokens.filter((token) => recordTokens.has(token)).length;
  if (!matches && !(querySubject && recordSubject && querySubject.key === recordSubject.key)) return 0;
  const keyword = (matches / queryTokens.length) * 2;
  const phrase = normalized(query).includes(normalized(record.content)) ? 0.5 : 0;
  const subject = querySubject && recordSubject && querySubject.key === recordSubject.key ? 0.8 : 0;
  const ageDays = Math.max(0, (now.getTime() - (Date.parse(record.updatedAt || record.createdAt) || now.getTime())) / 86400000);
  const recency = Math.max(0, 0.2 - ageDays / 3650);
  return Number((keyword + phrase + subject + typeRelevance(record, query) + Number(record.importance || 0) * 0.25 + Number(record.confidence || 0) * 0.3 + recency).toFixed(4));
}
function retrieve(records, query, { limit = 5, now = new Date() } = {}) {
  return records.filter((record) => isCurrent(record, now)).map((record) => ({ ...record, relevanceScore: scoreRecord(record, query, now) }))
    .filter((record) => record.relevanceScore >= 0.45)
    .sort((left, right) => right.relevanceScore - left.relevanceScore || String(right.updatedAt || right.createdAt).localeCompare(String(left.updatedAt || left.createdAt)))
    .slice(0, Math.max(0, limit));
}
module.exports = { normalized, tokens, detectSubject, isCurrent, scoreRecord, retrieve };

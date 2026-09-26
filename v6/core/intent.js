'use strict';

const { lower, clean } = require('./context');

// Temporal / weather / discourse words that share the CityName shape but are
// never a place. Keeps "Yarın hava..." from being read as the city "Yarın".
const NOT_A_CITY = new Set([
  'yarın', 'yarin', 'bugün', 'bugun', 'dün', 'dun', 'sabah', 'akşam', 'aksam', 'gece', 'öğlen', 'oglen',
  'hafta', 'ay', 'yıl', 'yil', 'gün', 'gun', 'saat', 'dakika', 'sıcaklık', 'sicaklik', 'hava', 'yağmur', 'yagmur',
  'yağış', 'yagis', 'rüzgâr', 'ruzgar', 'ne', 'nasıl', 'nasil', 'kaç', 'kac', 'nerede', 'kim', 'hangi', 'neydi',
  'peki', 'evet', 'hayır', 'hayir', 'lütfen', 'lutfen', 'merhaba', 'selam', 'teşekkür', 'tesekkur', 'tamam',
  'sonra', 'ardından', 'ardindan', 'önce', 'once', 'şimdi', 'simdi', 'yine', 'ayrıca', 'ayrica', 'son',
  've', 'ile', 'veya', 'ya', 'yada', 'ki', 'de', 'da', 'için', 'icin', 'hakkında', 'hakkinda', 'göre', 'gore',
  'şey', 'sey', 'durum', 'bilgi', 'haber', 'tahmin', 'tahmini', 'rapor', 'durumu', 'sıcak', 'sicak', 'soğuk', 'soguk'
]);
function isCityName(value) { return Boolean(value) && !NOT_A_CITY.has(String(value).toLocaleLowerCase('tr-TR')); }

function extractCity(message) {
  const value = clean(message);
  const known = value.match(/\b([A-ZÇÖŞÜ][a-zçğıöşü]+)(?:['’](?:te|ta|de|da))?\s*(?:hava|yağmur|sıcaklık|ne|nasıl)/u);
  if (known && isCityName(known[1])) return known[1];
  const generic = value.match(/\b([A-ZÇÖŞÜ][a-zçğıöşü]{2,})['’](?:te|ta|de|da)\b/u);
  return generic && isCityName(generic[1]) ? generic[1] : null;
}
function extractCurrency(message) {
  const value = lower(message);
  const base = /euro|eur/.test(value) ? 'EUR' : /dolar|usd|dollar/.test(value) ? 'USD' : /sterlin|gbp/.test(value) ? 'GBP' : null;
  return base ? { base, quote: 'TRY' } : null;
}
function extractQuery(message) { return clean(message).replace(/araştır|araştir|research|web|güncel|haber|kaynak/gi, '').replace(/\s+/g, ' ').trim(); }
function periodFromText(message) {
  const value = lower(message);
  if (/yarın|yarin|tomorrow/.test(value)) return 'tomorrow';
  if (/hafta sonu|weekend/.test(value)) return 'weekend';
  return 'today';
}
function hasWeatherWords(message) { return /hava|yağmur|sıcaklık|rüzgâr|bulut/.test(lower(message)); }
function isWeatherContinuation(message, context) {
  const value = clean(message);
  if (!context.weatherCity && !context.weatherTopic) return false;
  return /^(peki\s+)?(yarın|bugün|hafta sonu)(?:\s+(?:nasıl|ne|kaç))?\??$/iu.test(value) || /^(peki\s+)?(nasıl|ne|kaç)\??$/iu.test(value);
}
function parseMemoryCommand(message) {
  const original = clean(message);
  const value = lower(original);
  const dontForget = /\b(?:don't|dont)\s+forget\s+this\b/.test(value);
  const forget = !dontForget && (/\b(?:bunu\s+)?unut(?:ma)?\b|\bforget\s+this\b/.test(value));
  const remember = /\b(?:bunu\s+)?(?:hatırla|kaydet)\b|hafızana\s+al|aklında\s+tut|\bremember\s+(?:this|that)\b|don['’]?t\s+forget\s+this|\bsave\s+this\b/.test(value);
  if (!forget && !remember) return null;
  const operation = forget ? 'forget' : 'remember';
  let content = original;
  if (forget) content = content.replace(/\b(?:bunu\s+)?unut(?:ma)?\b|\bforget\s+this\b/giu, ' ');
  else content = content.replace(/\b(?:bunu\s+)?(?:hatırla|kaydet)\b|hafızana\s+al|aklında\s+tut/giu, ' ').replace(/\bremember\s+(?:this|that)\b|don['’]?t\s+forget\s+this|\bsave\s+this\b/giu, ' ');
  return { operation, content: content.replace(/^[\s,:;.!?-]+|[\s,:;.!?-]+$/g, '').replace(/\s+/g, ' ').trim() };
}
function classifyIntent(message, context = {}) {
  const value = lower(message);
  const weatherWords = hasWeatherWords(message);
  const weatherQuery = weatherWords && /nasıl|ne|kaç|değer|derece|°|yarın|bugün|hafta sonu/.test(value) && !/çok güzel|güzel|keyifli/.test(value);
  const weatherContinuation = isWeatherContinuation(message, context);
  const command = parseMemoryCommand(message);
  const memoryQuery = /hatırlıyor musun|hatırlıyor|hatırlar mısın|ne konuştuk|geçen konuştuk|\bad[ıi]m\s+(?:ne|kim|neydi)|\bismim\s+(?:ne|kim)|\bmy\s+name\s+is|hangi\s+.*işletim\s+sistem/i.test(value);
  const memoryAction = Boolean(command);
  const currency = extractCurrency(message);
  const research = /araştır|araştir|research|web|güncel|haber|news|kaynak/.test(value);
  const city = extractCity(message);
  const entities = {};
  let intent = 'chat';
  let topic = context.topic || null;
  let topicMode = context.topic ? 'continuation' : 'standalone';
  let continuation = false;
  let requiresTool = false;
  let requiresResearch = false;
  let requiresMemory = false;
  let requiresClarification = false;
  let memoryOperation = null;
  if (memoryAction) {
    intent = 'memory'; topic = 'memory'; topicMode = 'action'; requiresMemory = true; memoryOperation = command.operation;
    entities.memory = command.content;
  } else if (weatherQuery || weatherContinuation) {
    intent = 'weather'; topic = 'weather'; continuation = weatherContinuation; requiresTool = true;
    if (city) entities.city = city;
    if (!entities.city && context.weatherCity) entities.city = context.weatherCity;
    entities.period = periodFromText(message);
    requiresClarification = !entities.city && !context.weatherCity;
  } else if (currency && !/bitcoin|kripto/i.test(value) && /kuru?|kaç|ne kadar|değer|price|exchange/.test(value)) {
    intent = 'currency'; topic = 'currency'; requiresTool = true; entities.currency = currency;
  } else if (research) {
    intent = 'research'; topic = 'research'; requiresTool = true; requiresResearch = true; entities.query = extractQuery(message);
  } else if (memoryQuery) {
    intent = 'memory'; topic = 'memory'; topicMode = 'recall'; requiresMemory = true; entities.query = message;
  } else if (weatherWords) {
    topic = 'weather'; topicMode = context.weatherTopic ? 'continuation' : 'standalone';
  }
  const confidence = requiresClarification ? 0.68 : intent === 'chat' ? 0.72 : 0.94;
  return { intent, topic, topicMode, continuation, requiresTool, requiresResearch, requiresMemory, requiresClarification, entities, confidence, memoryAction, memoryOperation, memoryRecall: !memoryAction && memoryQuery };
}
module.exports = { classifyIntent, extractCity, extractCurrency, extractQuery, periodFromText, parseMemoryCommand };

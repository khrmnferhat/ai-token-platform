'use strict';

const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
const lower = (value) => clean(value).toLocaleLowerCase('tr-TR');
const has = (value, pattern) => pattern.test(lower(value));
const currentPattern = /bugün|bugünkü|şu an|şimdi|güncel|son durum|en son|bu hafta|bu ay|latest|today|current|şu anda/iu;
const explicitResearchPattern = /araştır|araştir|research|web'den|web den|kaynakları bul|kaynakları kontrol|güncel bilgileri kontrol|detaylı incele|detayli incele/iu;
const comparisonPattern = /karşılaştır|karisaltir|compare|farkları|farkli|hangisi daha|hangisi en/iu;
const historicalPattern = /\b(19|20)\d{2}\b|geçmiş|gecmis|tarihî|tarihi|historical/iu;
const purchasePattern = /alacağım|alacagim|satın al|satin al|almak istiyorum/iu;
// A time word alone is not a request for current information: "Bugün biraz
// yorgunum." is small talk, not a web lookup.
const ASKS_INFORMATION = /[?？]|\b(nasıl|nasil|ne\s+kadar|kaç|kac|fiyat|değer|deger|haber|nedir|hangi|nerede|güncel|guncel)\b/iu;

function buildPlan(query, { depth = 'standard', memory = [] } = {}) {
  const objective = clean(query) || 'İlgili konuda güvenilir ve güncel bilgiyi doğrulamak';
  const questions = [objective];
  if (comparisonPattern.test(lower(query))) questions.push('Karşılaştırılan seçeneklerin avantajları, dezavantajları ve güncel farkları nedir?');
  if (currentPattern.test(lower(query))) questions.push('Bu bilginin güncel tarih ve kaynaklarla doğrulanması gerekiyor mu?');
  if (purchasePattern.test(lower(query))) questions.push('Bütçe, kullanım amacı ve tercih kriterleri nedir?');
  const queries = [objective];
  if (depth !== 'quick' && comparisonPattern.test(lower(query))) queries.push(`${objective} karşılaştırma avantaj dezavantaj`);
  if (depth === 'deep' || (currentPattern.test(lower(query)) && depth === 'standard')) queries.push(`${objective} güncel resmi kaynak`);
  return { objective, questions: [...new Set(questions)], searchQueries: [...new Set(queries)].slice(0, depth === 'quick' ? 1 : depth === 'deep' ? 3 : 2), sourceTypes: comparisonPattern.test(lower(query)) ? ['official', 'technical', 'reputable_publication'] : ['official', 'news_report', 'market_data'], expectedEvidence: 'En az bir doğrudan veya birincil kaynak; gerekirse iki farklı kaynak türü', verificationNeeded: true, memoryHints: memory.slice(0, 3).map((item) => item.content || item.text).filter(Boolean), depth };
}

function planReasoning(message, intelligence = {}, context = {}) {
  const value = clean(message);
  const low = lower(value);
  const previousTopic = context.researchTopic || (context.topic !== 'research' ? context.topic : null) || null;
  // A follow-up of a WEATHER topic is a weather question, not a research request.
  // Without this, "Peki yarın durum nasıldı?" after a weather task was sent to
  // web research and answered with unrelated scraped content.
  const isFollowUp = /^(peki|peki türkiye'de|peki turkiye'de|bunu|bu konuyu|detaylı|daha detaylı|karşılaştır|kaynak)/iu.test(low) && Boolean(previousTopic) && previousTopic !== 'weather';
  const researchTopic = isFollowUp ? previousTopic : value;
  const explicitResearch = has(value, explicitResearchPattern);
  const years = value.match(/\b(?:19|20)\d{2}\b/g) || [];
  const weatherContext = /hava|yağmur|sıcaklık|rüzgâr|bulut/iu.test(value);
  const current = !weatherContext && ASKS_INFORMATION.test(low) && (has(value, currentPattern) || years.includes(String(new Date().getFullYear())));
  const historical = has(value, historicalPattern) && !current;
  const comparison = has(value, comparisonPattern);
  const purchase = has(value, purchasePattern) && !explicitResearch && !current && !comparison;
  const toolIntent = intelligence.intent === 'weather' || intelligence.intent === 'currency';
  const question = /[?？]|\b(ne|nedir|nasıl|nasil|kaç|kac|nerede|kim)\b/iu.test(low);
  const research = explicitResearch || current || historical || comparison || intelligence.intent === 'research' || isFollowUp;
  const taskType = intelligence.intent === 'memory' ? 'memory' : toolIntent ? 'tool_action' : purchase ? 'planning' : comparison ? 'comparison' : research ? 'research' : question ? 'question' : 'chat';
  const answerMode = purchase ? 'clarify' : toolIntent ? 'execute' : comparison ? 'compare' : research ? 'research' : intelligence.intent === 'memory' ? 'direct' : question ? 'explain' : 'direct';
  const requiresClarification = purchase || Boolean(intelligence.requiresClarification);
  const questions = purchase ? ['Hangi bütçe aralığın?', 'Evde tek kişi mi kullanacaksın, yoksa ofiste/misafirlerle mi?', 'Kahve tercihin veya özelliklerin var mı?'] : intelligence.requiresClarification ? [value] : [];
  const researchDepth = comparison || explicitResearch && /detaylı|derin|analiz|kapsamlı/iu.test(low) ? 'deep' : current ? 'quick' : 'standard';
  return { taskType, answerMode, requiresResearch: research && !toolIntent, requiresTool: Boolean(toolIntent), requiresClarification, researchDepth: research && !toolIntent ? researchDepth : 'none', entities: { ...(intelligence.entities || {}), topic: intelligence.topic || previousTopic }, assumptions: previousTopic && isFollowUp ? [`önceki araştırma bağlamı: ${previousTopic}`] : [], questions, confidence: requiresClarification ? 0.68 : research ? 0.82 : 0.88, isFollowUp, isHistorical: historical, researchPlan: research && !toolIntent ? buildPlan(researchTopic, { depth: researchDepth, memory: context.facts || [] }) : null };
}

module.exports = { planReasoning, buildPlan };

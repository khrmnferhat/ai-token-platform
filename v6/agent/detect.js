'use strict';

const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
const lower = (value) => clean(value).toLocaleLowerCase('tr-TR');

// Signals that a message asks for SEQUENCED work rather than one answer.
const SEQUENCER = /\b(sonra|sonrasında|ardından|ve\s+sonra|peki\s+.*\bsonra|ilk\s+.*\bsonra|ilk\s+.*\bardından|2\s*adım|üç\s*adım|iki\s*adım|adım\s+adım|step\s+by\s+step)\b/iu;
const ENUMERATION = /(\d\s*[\.\)]\s+.*){2,}/u;
const MULTI_TARGET = /\b(iki|üç|3|4|birkaç|çeşitli|farklı)\s+(kaynak|ürün|seçenek|şehir|model|alternatif|kaynak\s+grubu)/iu;
const COMPARE_SIGNAL = /\b(karşılaştır|karisaltir|compare|kıyasla|farkları\s+ne|hangisi\s+(daha|en)|avantaj|dezavantaj)\b/iu;
const SUMMARY_SIGNAL = /\b(özet|summary|özetle|kısaca|kısa\s+bir|sonuç\s+çıkar|raporla|listele)\b/iu;
const RESEARCH_SIGNAL = /\b(araştır|araştir|research|güncel\s+(bilgi|veri|kaynak)|kaynak\s+(bul|araştır|getir)|haber)\b/iu;
const CROSS_CHECK_SIGNAL = /\b(doğrula|teyit\s+et|kontrol\s+et|karşılaştır\s+.*\bsource|ikinci\s+(kaynak|göz)|bağımsız\s+kaynak)\b/iu;
const APPROVAL_RISK_SIGNAL = /\b(para\s+gönder|ödeme\s+yap|transfer|satın\s+al|iptal\s+et|dosya\s+sil|hesabı\s+(sil|kapat|değiştir)|mesaj\s+gönder)\b/iu;

const SIMPLE_QUESTION = /^(.{0,80}?)(\?|)$/u;

const { countTimeReferences } = require('./periods');

// Signals that a message asks for SEQUENCED work rather than one answer.
function countSignals(value) {
  const text = clean(value);
  if (!text) return 0;
  let score = 0;
  if (SEQUENCER.test(text)) score += 2;
  if (ENUMERATION.test(text)) score += 2;
  if (MULTI_TARGET.test(text)) score += 1;
  if (COMPARE_SIGNAL.test(text)) score += 1;
  if (SUMMARY_SIGNAL.test(text)) score += 1;
  if (RESEARCH_SIGNAL.test(text)) score += 1;
  if (CROSS_CHECK_SIGNAL.test(text)) score += 1;
  return score;
}

// A request is agentic only when it implies MULTIPLE dependent work units.
// "Bugün hava nasıl?" is a single tool call and must stay a normal tool execution (spec §5).
function detectTask(message, { intelligence = {}, reasoning = {}, context = {}, decision = null } = {}) {
  const text = clean(message);
  const value = lower(text);
  const base = {
    agentic: false,
    taskType: null,
    confidence: 0,
    reason: 'single_step_request',
    signals: { sequencer: false, enumeration: false, multiTarget: false, compare: false, summary: false, research: false, crossCheck: false, risk: false }
  };
  if (!text || text.length < 12) return { ...base, reason: 'too_short' };
  if (APPROVAL_RISK_SIGNAL.test(value)) {
    return { ...base, agentic: true, taskType: 'analysis', confidence: 0.7, reason: 'requires_approval_gate', signals: { ...base.signals, risk: true } };
  }
  if (intelligence.memoryAction) return { ...base, reason: 'memory_action' };
  if (intelligence.intent === 'memory' && !intelligence.memoryRecall) return { ...base, reason: 'memory_action' };

  const signals = {
    sequencer: SEQUENCER.test(text),
    enumeration: ENUMERATION.test(text),
    multiTarget: MULTI_TARGET.test(text),
    compare: COMPARE_SIGNAL.test(text),
    summary: SUMMARY_SIGNAL.test(text),
    research: RESEARCH_SIGNAL.test(text),
    crossCheck: CROSS_CHECK_SIGNAL.test(text),
    risk: APPROVAL_RISK_SIGNAL.test(value)
  };
  const score = countSignals(text);

  // Two DISTINCT time references in one REQUEST ("bugün ... yarın ...") are two
  // lookups. Mere mention is not a request: "Bugün ve yarın hakkında konuşalım."
  // is small talk and must stay a normal conversation.
  const periods = countTimeReferences(text);
  const requestLike = /[?？]/iu.test(text) || /\b(hava|yağmur|yağış|sıcaklık|rüzgâr|ne\s+kadar|kaç\s+derece|özetle|ozetle|karşılaştır|karsilastir|kontrol\s+et|bak\s+ve|haber|fiyat|kur)\b/iu.test(text);
  if (periods >= 2 && requestLike) {
    return { agentic: true, taskType: 'multi_step_lookup', confidence: 0.85, reason: 'multi_period_request', signals: { ...signals, multiPeriod: true }, score };
  }

  // A single tool intent with no sequencing is never an agent task.
  const singleToolIntent = ['weather', 'currency'].includes(intelligence.intent) && !reasoning.requiresResearch;
  if (singleToolIntent && !signals.sequencer && !signals.enumeration && !signals.compare && !signals.summary) {
    return { ...base, signals, reason: 'single_tool_intent' };
  }
  if (decision?.action === 'clarify' && !signals.sequencer) return { ...base, signals, reason: 'pending_clarification' };

  // Sequencing language alone is the strongest and most reliable agent trigger.
  if (signals.sequencer || signals.enumeration) {
    const taskType = signals.compare ? 'comparison' : signals.research || reasoning.requiresResearch ? 'research' : 'multi_step_lookup';
    return { agentic: true, taskType, confidence: 0.9, reason: signals.sequencer ? 'sequential_request' : 'enumerated_request', signals, score };
  }
  // Research + comparison / cross-check is multi-step even without explicit sequencing.
  if (signals.research && (signals.compare || signals.crossCheck)) {
    return { agentic: true, taskType: 'comparison', confidence: 0.85, reason: 'research_with_comparison', signals, score };
  }
  if (signals.multiTarget && (signals.compare || signals.research)) {
    return { agentic: true, taskType: signals.compare ? 'comparison' : 'information_gathering', confidence: 0.8, reason: 'multiple_targets', signals, score };
  }
  if (signals.compare && signals.summary) {
    return { agentic: true, taskType: 'comparison', confidence: 0.78, reason: 'compare_and_summarize', signals, score };
  }
  // Plain research stays a single research call unless it asks for synthesis steps.
  if (signals.research && signals.summary && reasoning.requiresResearch) {
    return { agentic: true, taskType: 'research', confidence: 0.72, reason: 'research_with_synthesis', signals, score };
  }
  if (signals.crossCheck && (signals.research || intelligence.intent === 'research')) {
    return { agentic: true, taskType: 'research', confidence: 0.75, reason: 'cross_source_verification', signals, score };
  }
  return { ...base, signals, reason: score >= 2 ? 'below_agent_threshold' : 'simple_request' };
}

module.exports = { detectTask, countSignals, SEQUENCER, ENUMERATION, MULTI_TARGET, COMPARE_SIGNAL, SUMMARY_SIGNAL, RESEARCH_SIGNAL, CROSS_CHECK_SIGNAL, APPROVAL_RISK_SIGNAL, SIMPLE_QUESTION };

'use strict';

function clean(value) { return String(value || '').trim(); }
function lower(value) { return clean(value).toLocaleLowerCase('tr-TR'); }
function buildContext(session = {}, facts = [], identity = null, query = '') {
  const messages = Array.isArray(session.messages) ? session.messages : [];
  return {
    sessionId: session.id || null,
    messages,
    recent: messages.slice(-8),
    lastUser: query || [...messages].reverse().find((item) => item.role === 'user')?.content || '',
    lastAssistant: [...messages].reverse().find((item) => item.role === 'assistant')?.content || '',
    topic: session.context?.topic || null,
    topicMode: session.context?.topicMode || null,
    entities: session.context?.entities || {},
    lastIntent: session.context?.lastIntent || null,
    weatherCity: session.context?.weatherCity || null,
    weatherTopic: Boolean(session.context?.weatherTopic),
    facts: Array.isArray(facts) ? facts.slice(0, 5) : [],
    identity: identity || { name: null, explicitFacts: [], preferences: [], profile: {} },
    researchTopic: session.context?.researchTopic || null,
    researchPlan: session.context?.researchPlan || null,
    researchSources: Array.isArray(session.context?.researchSources) ? session.context.researchSources : [],
    learning: session.context?.learning || { relevantLessons: [] }
  };
}
function updateContext(current = {}, intelligence = {}, result = {}) {
  const entities = { ...(current.entities || {}) };
  if (intelligence.entities?.city) entities.city = intelligence.entities.city;
  if (intelligence.entities?.currency) entities.currency = intelligence.entities.currency;
  if (intelligence.entities?.query) entities.query = intelligence.entities.query;
  if (intelligence.entities?.memory) entities.memory = intelligence.entities.memory;
  return {
    ...current,
    topic: intelligence.topic || current.topic || null,
    topicMode: intelligence.topicMode || 'standalone',
    entities,
    weatherCity: intelligence.topic === 'weather' ? (intelligence.entities?.city || current.weatherCity || null) : current.weatherCity,
    weatherTopic: current.weatherTopic || intelligence.topic === 'weather',
    lastIntent: result.route || intelligence.intent || current.lastIntent || null,
    lastTool: result.tool || null,
    clarificationPending: result.route === 'clarify' || Boolean(result.requiresClarification),
    researchTopic: result.research?.objective || intelligence.researchTopic || current.researchTopic || null,
    researchPlan: result.researchPlan || intelligence.researchPlan || current.researchPlan || null,
    researchSources: result.sources || current.researchSources || [],
    learning: result.learning || current.learning || { relevantLessons: [] },
    lastResultAt: new Date().toISOString()
  };
}
function promptContext(context) {
  const topic = context.topic ? `Konu: ${context.topic}.` : '';
  const weather = context.weatherCity ? `Hava bağlamı: ${context.weatherCity}.` : '';
  const facts = context.facts.length ? `Alakalı kalıcı bilgiler: ${context.facts.map((item) => item.content || item.text).join('; ')}` : 'Alakalı kalıcı bilgi: yok';
  const nameQuery = /ad[ıi]m|isim|name/iu.test(context.lastUser || '');
  const name = context.identity?.name && nameQuery ? `Kullanıcının açıkça belirttiği adı: ${context.identity.name}.` : '';
  const lessons = context.learning?.relevantLessons?.slice(0, 2) || [];
  const learning = lessons.length ? `İlgili öğrenilmiş davranış: ${lessons.map((item) => item.lesson).join('; ')}` : '';
  return [topic, weather, facts, name, learning].filter(Boolean).join(' ');
}
module.exports = { buildContext, updateContext, promptContext, clean, lower };

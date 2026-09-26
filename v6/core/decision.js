'use strict';

function decide(intelligence = {}) {
  const intent = intelligence.intent || 'chat';
  if (intent === 'memory') {
    if (intelligence.memoryAction) return { type: 'memory', action: 'memory', tool: null, requiresMemory: true };
    return { type: 'chat', action: 'chat', tool: null, requiresModel: true, requiresMemory: true };
  }
  if (intelligence.requiresClarification && intent !== 'weather' && intent !== 'currency') return { type: 'clarification', action: 'clarify', tool: null, requiresClarification: true };
  if (intelligence.requiresResearch) return { type: 'research', action: 'research', tool: 'web_research', requiresTool: true, requiresResearch: true };
  if (intent === 'weather') {
    if (intelligence.requiresClarification) return { type: 'weather', action: 'clarify', tool: null, requiresClarification: true };
    return { type: 'weather', action: 'tool', tool: 'weather', requiresTool: true };
  }
  if (intent === 'currency') return { type: 'currency', action: 'tool', tool: 'currency', requiresTool: true };
  if (intent === 'research') return { type: 'research', action: 'research', tool: 'web_research', requiresTool: true, requiresResearch: true };
  return { type: 'chat', action: 'chat', tool: null, requiresModel: true };
}

function legacyRoute(intelligence, context = {}) {
  const decision = decide(intelligence);
  if (decision.type === 'weather') return { type: 'weather', city: intelligence.entities?.city || context.weatherCity || null, period: intelligence.entities?.period || 'today' };
  if (decision.type === 'currency') return { type: 'currency', ...(intelligence.entities?.currency || {}) };
  if (decision.type === 'research') return { type: 'research', query: intelligence.entities?.query || '' };
  if (decision.type === 'memory') return { type: 'memory' };
  if (decision.type === 'clarification') return { type: 'clarification', questions: intelligence.questions || [] };
  return { type: 'chat' };
}

module.exports = { decide, legacyRoute };

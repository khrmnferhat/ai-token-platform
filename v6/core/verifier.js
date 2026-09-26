'use strict';

function cleanAnswer(value) { return String(value || '').replace(/\s+/g, ' ').trim(); }
function verifyResult(result = {}, intelligence = {}) {
  const hasAnswer = Boolean(cleanAnswer(result.answer));
  const toolOk = !result.tool || result.ok !== false;
  const clarified = result.action === 'clarify' || result.route === 'clarify';
  const research = result.research || null;
  const researchOk = !intelligence.requiresResearch || Boolean(research?.completed && research.sources?.length);
  const contradictions = research?.contradictions || [];
  return {
    ok: hasAnswer && (toolOk || clarified) && researchOk,
    mode: clarified ? 'clarification' : result.tool ? 'tool' : 'response',
    reason: !hasAnswer ? 'empty_answer' : !researchOk ? 'no_reliable_evidence' : contradictions.length ? 'research_contradiction' : clarified ? 'clarification_available' : toolOk ? 'answer_available' : 'tool_failed',
    researchSucceeded: !intelligence.requiresResearch || researchOk,
    sourcesRequired: Boolean(intelligence.requiresResearch),
    contradictionsDetected: contradictions.length,
    checkedAt: new Date().toISOString(),
    intent: intelligence.intent || null
  };
}

module.exports = { verifyResult };
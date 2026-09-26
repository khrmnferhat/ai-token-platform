'use strict';

const clamp = (value) => Math.max(0, Math.min(1, Number(value) || 0));
function calculateConfidence({ verification = {}, repetition = 0, userCorrection = false, toolSuccess = false, researchEvidence = false, consistency = 0, failure = false } = {}) {
  const score = 0.18
    + (verification.ok ? 0.22 : 0)
    + Math.min(0.2, Math.max(0, repetition - 1) * 0.08)
    + (userCorrection ? 0.3 : 0)
    + (toolSuccess ? 0.12 : 0)
    + (researchEvidence ? 0.12 : 0)
    + Math.min(0.1, Math.max(0, consistency) * 0.1)
    - (failure ? 0.22 : 0);
  return Number(clamp(score).toFixed(3));
}
function calculateImportance({ type = 'response', userCorrection = false, repetition = 0, taskImpact = false, personalization = false } = {}) {
  const base = { routing: 0.68, 'tool-selection': 0.7, research: 0.58, clarification: 0.62, memory: 0.5, response: 0.42, verification: 0.6, preference: 0.72 }[type] || 0.4;
  return Number(clamp(base + (userCorrection ? 0.2 : 0) + Math.min(0.15, Math.max(0, repetition - 1) * 0.05) + (taskImpact ? 0.1 : 0) + (personalization ? 0.08 : 0)).toFixed(3));
}
module.exports = { calculateConfidence, calculateImportance, clamp };

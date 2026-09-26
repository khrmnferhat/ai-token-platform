'use strict';

// Deterministic execution limits. Agentic execution is ALWAYS bounded (see Sardis V6 agent spec §30/§31).
const LIMITS = {
  maxSteps: 8,
  maxAttemptsPerStep: 2,
  maxTaskDurationMs: 60000,
  maxToolCalls: 12,
  stepTimeoutMs: 15000,
  maxRetriesPerStep: 2,
  maxIdenticalFailureSignatures: 2,
  maxRawResultChars: 1200,
  maxSummaryChars: 320,
  maxRetainedTasks: 200,
  maxEventsPerTask: 60,
  maxGlobalEvents: 200
};

function resolveLimits(overrides = {}) {
  const limits = { ...LIMITS };
  for (const [key, value] of Object.entries(overrides || {})) {
    if (value === undefined || value === null) continue;
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) limits[key] = Math.floor(number);
  }
  return limits;
}

module.exports = { LIMITS, resolveLimits };

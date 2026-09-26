'use strict';

// Failure classification and recovery decisions (spec §14/§15).
// Retry is allowed ONLY for transient classes; everything else fails fast.
const RETRYABLE = new Set(['TIMEOUT', 'TOOL_FAILURE', 'NETWORK_ERROR', 'TEMPORARY_FAILURE', 'RATE_LIMITED', 'SERVICE_UNAVAILABLE']);

const CATEGORY = Object.freeze({
  TRANSIENT: 'transient',
  INVALID_INPUT: 'invalid_input',
  PERMISSION: 'permission',
  UNKNOWN_TOOL: 'unknown_tool',
  SCHEMA: 'schema',
  PLAN_INVALID: 'plan_invalid',
  DANGEROUS: 'dangerous',
  MISSING_INPUT: 'missing_input',
  EMPTY_RESULT: 'empty_result',
  UNKNOWN: 'unknown'
});

const ACTION = Object.freeze({
  RETRY: 'retry',
  ALTERNATIVE: 'alternative',
  CLARIFY: 'clarify',
  APPROVE: 'approve',
  SKIP: 'skip',
  ABORT: 'abort'
});

const CODE_CATEGORY = Object.freeze({
  TIMEOUT: CATEGORY.TRANSIENT,
  TOOL_FAILURE: CATEGORY.TRANSIENT,
  NETWORK_ERROR: CATEGORY.TRANSIENT,
  TEMPORARY_FAILURE: CATEGORY.TRANSIENT,
  RATE_LIMITED: CATEGORY.TRANSIENT,
  SERVICE_UNAVAILABLE: CATEGORY.TRANSIENT,
  TOOL_NOT_FOUND: CATEGORY.UNKNOWN_TOOL,
  TOOL_DISABLED: CATEGORY.UNKNOWN_TOOL,
  TOOL_PERMISSION_DENIED: CATEGORY.PERMISSION,
  INVALID_TOOL_INPUT: CATEGORY.INVALID_INPUT,
  INVALID_INPUT_SCHEMA: CATEGORY.SCHEMA,
  SCHEMA_ERROR: CATEGORY.SCHEMA,
  PLAN_REJECTED: CATEGORY.PLAN_INVALID,
  DANGEROUS_ACTION: CATEGORY.DANGEROUS,
  MISSING_REQUIRED_INPUT: CATEGORY.MISSING_INPUT
});

function classifyFailure(error) {
  const code = String(error?.code || '').toUpperCase();
  const message = String(error?.message || error || '');
  if (CODE_CATEGORY[code]) return { category: CODE_CATEGORY[code], code: code || null, message, retryable: RETRYABLE.has(code) };
  if (/abort|timed out|timeout|network|econnreset|socket hang up|fetch failed|temporar|service unavailable|503|502|504/iu.test(message)) {
    return { category: CATEGORY.TRANSIENT, code: code || 'TIMEOUT', message, retryable: true };
  }
  if (/permission|izin|forbidden|denied/iu.test(message)) return { category: CATEGORY.PERMISSION, code: code || 'TOOL_PERMISSION_DENIED', message, retryable: false };
  if (/required|gerekiyor|missing/iu.test(message)) return { category: CATEGORY.MISSING_INPUT, code: code || 'MISSING_REQUIRED_INPUT', message, retryable: false };
  return { category: CATEGORY.UNKNOWN, code: code || null, message, retryable: false };
}

function decideRecovery({ failure, attempts = 0, maxAttempts = 2, hasAlternative = false, critical = true } = {}) {
  const category = failure?.category || CATEGORY.UNKNOWN;
  if (category === CATEGORY.DANGEROUS) return { action: ACTION.ABORT, reason: 'dangerous_action_blocked' };
  if (category === CATEGORY.PERMISSION) return { action: ACTION.ABORT, reason: 'permission_denied' };
  if (category === CATEGORY.PLAN_INVALID) return { action: ACTION.ABORT, reason: 'plan_invalid' };
  if (category === CATEGORY.MISSING_INPUT) return { action: ACTION.CLARIFY, reason: 'missing_required_information' };
  if (category === CATEGORY.INVALID_INPUT || category === CATEGORY.SCHEMA) return { action: ACTION.ABORT, reason: category === CATEGORY.SCHEMA ? 'schema_error' : 'invalid_input' };
  if (category === CATEGORY.UNKNOWN_TOOL) return { action: hasAlternative ? ACTION.ALTERNATIVE : ACTION.ABORT, reason: 'unknown_tool' };
  if (category === CATEGORY.EMPTY_RESULT) return critical ? { action: ACTION.ABORT, reason: 'empty_result' } : { action: ACTION.SKIP, reason: 'optional_step_empty' };
  if (category === CATEGORY.TRANSIENT) {
    if (attempts < maxAttempts) return { action: ACTION.RETRY, reason: 'transient_failure' };
    if (hasAlternative) return { action: ACTION.ALTERNATIVE, reason: 'transient_exhausted' };
    return { action: ACTION.ABORT, reason: 'retries_exhausted' };
  }
  if (hasAlternative) return { action: ACTION.ALTERNATIVE, reason: 'unclassified_failure' };
  return { action: critical ? ACTION.ABORT : ACTION.SKIP, reason: 'unrecoverable_failure' };
}

// Stable signature used for repeated-identical-failure detection (loop protection §31).
function failureSignature(failure) {
  return `${failure?.category || CATEGORY.UNKNOWN}:${failure?.code || 'none'}`;
}

module.exports = { CATEGORY, ACTION, RETRYABLE, classifyFailure, decideRecovery, failureSignature };

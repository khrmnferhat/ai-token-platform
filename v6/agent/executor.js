'use strict';

const { STEP_STATUS, TASK_STATUS } = require('./task');
const { decide, decideClarification, DECISION } = require('./policy');
const { classifyFailure, decideRecovery, failureSignature, ACTION } = require('./recovery');
const { verifyResult } = require('../core/verifier');

const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
const nowIso = () => new Date().toISOString();

// ---------------------------------------------------------------------------
// Result compression (spec §20): raw / normalized / summary stay distinct so
// the final synthesis only receives the data it actually needs.
// ---------------------------------------------------------------------------
function compressValue(value, budget) {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.length > budget ? `${value.slice(0, budget)}…` : value;
  if (Array.isArray(value)) {
    return value.slice(0, 4).map((item) => (item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).map(([key, child]) => [key, compressValue(child, Math.max(40, Math.floor(budget / 3)))]).filter(([, child]) => child !== undefined))
      : compressValue(item, budget)));
  }
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).slice(0, 12).map(([key, child]) => [key, compressValue(child, budget)]).filter(([, child]) => child !== undefined));
  }
  return undefined;
}

function normalizeResult(execution, limits) {
  const data = execution?.data && typeof execution.data === 'object' ? execution.data : {};
  const answer = clean(data.answer || data.detail || execution?.error?.message || '');
  let raw = '';
  try { raw = JSON.stringify(data); } catch { raw = ''; }
  return {
    summary: answer.slice(0, limits.maxSummaryChars),
    normalized: compressValue(data, limits.maxSummaryChars) || {},
    raw: raw.length > limits.maxRawResultChars ? `${raw.slice(0, limits.maxRawResultChars)}…` : raw,
    source: execution?.metadata?.source || null,
    fetchedAt: execution?.metadata?.fetchedAt || null,
    durationMs: execution?.metadata?.durationMs ?? null
  };
}

// Step-local payload; the next step reads ONLY this, never the full history.
function stepPayload(step) {
  return {
    stepId: step.id,
    tool: step.tool || null,
    description: step.description,
    summary: step.result?.summary || '',
    data: step.result?.normalized || {}
  };
}

function alternativeTool(registry, step) {
  if (!registry || !step.tool) return null;
  const tool = registry.get(step.tool);
  if (!tool) return null;
  for (const capability of Array.isArray(tool.capabilities) ? tool.capabilities : []) {
    const candidate = (registry.findByCapability(capability) || []).find((item) => item.name !== step.tool && item.enabled !== false);
    if (candidate) return candidate.name;
  }
  return null;
}

module.exports = { compressValue, normalizeResult, stepPayload, alternativeTool, clean, nowIso, STEP_STATUS, TASK_STATUS, decide, decideClarification, DECISION, classifyFailure, decideRecovery, failureSignature, ACTION, verifyResult };


// ---------------------------------------------------------------------------
// Internal (non-tool) reasoning steps: deterministic synthesis over evidence.
// They never call an external service and never call the LLM.
// ---------------------------------------------------------------------------
function runCompareStep(step, task) {
  const parent = task.steps.find((item) => item.id === (step.dependsOn || [])[0]) || {};
  const normalized = parent.result?.normalized || {};
  const sources = Array.isArray(normalized.sources) ? normalized.sources : [];
  const claims = Array.isArray(normalized.claims) ? normalized.claims : [];
  const contradictions = Array.isArray(normalized.contradictions) ? normalized.contradictions : [];
  const lines = sources.slice(0, 3).map((item, index) => `${index + 1}) ${clean(item?.title || item?.url || 'kaynak')} (${item?.sourceType || 'web'})`);
  const summary = lines.length
    ? `${sources.length} kaynak karşılaştırıldı: ${lines.join(' | ')}. ${claims.length} iddia çıkarıldı${contradictions.length ? ', ancak kaynaklar arasında çelişki var.' : '.'}`
    : 'Karşılaştırılacak güvenilir kaynak bulunamadı.';
  return { ok: true, data: { answer: summary, sourceCount: sources.length, claimCount: claims.length, contradictionCount: contradictions.length }, metadata: { source: 'sardis-agent' } };
}

function runSynthesizeStep(step, task, limits) {
  const parents = (step.dependsOn || []).map((id) => task.steps.find((item) => item.id === id)).filter(Boolean);
  const payloads = (parents.length ? parents : task.steps.filter((item) => item.status === STEP_STATUS.COMPLETED)).map(stepPayload).filter((item) => item.summary);
  const answer = payloads.length ? payloads.map((item) => item.summary).join(' ').replace(/\s+/g, ' ').trim() : 'Görev için doğrulanabilir veri üretilemedi.';
  return { ok: true, data: { answer: answer.slice(0, limits.maxSummaryChars * 4), parts: payloads.map((item) => ({ stepId: item.stepId, tool: item.tool, summary: item.summary })) }, metadata: { source: 'sardis-agent' } };
}

// ---------------------------------------------------------------------------
// Bounded step execution. The Universal Tool Layer is the ONLY outbound path.
// ---------------------------------------------------------------------------
async function runStep(step, task, { router, registry, limits, onEvent, approved = false }) {
  const started = Date.now();
  step.status = STEP_STATUS.RUNNING;
  step.startedAt = nowIso();
  onEvent?.('step_started', { stepId: step.id, order: step.order, tool: step.tool, stepType: step.type });

  const tool = step.type === 'tool' ? registry?.get?.(step.tool) : null;
  const policy = decide({ tool, stepType: step.type, approved });
  if (policy.decision === DECISION.DENY) {
    step.status = STEP_STATUS.FAILED;
    step.error = { code: 'DANGEROUS_ACTION', message: 'Tehlikeli islem engellendi.', category: 'dangerous' };
    step.finishedAt = nowIso();
    step.verification = verifyResult({ answer: '', tool: step.tool, ok: false }, { intent: step.type });
    onEvent?.('step_failed', { stepId: step.id, code: 'DANGEROUS_ACTION', category: 'dangerous' });
    return { ok: false, failure: { category: 'dangerous', code: 'DANGEROUS_ACTION', message: step.error.message } };
  }
  if (policy.decision === DECISION.ASK) {
    step.requiresApproval = true;
    step.approvalReason = step.approvalReason || policy.approvalReason;
    step.status = STEP_STATUS.BLOCKED;
    step.finishedAt = nowIso();
    return { ok: false, blocked: true, requiresApproval: true, approvalReason: step.approvalReason, failure: { category: 'approval_required', code: 'APPROVAL_REQUIRED', message: 'Kullanici onayi gerekiyor.' } };
  }

  let lastFailure = null;
  while (step.attempts < step.maxAttempts) {
    step.attempts += 1;
    let execution;
    if (step.type === 'tool') {
      execution = await router.execute(step.tool, step.input, { capability: step.capability || null, timeoutMs: step.timeoutMs });
    } else if (step.input?.mode === 'compare') {
      execution = runCompareStep(step, task);
    } else {
      execution = runSynthesizeStep(step, task, limits);
    }

    if (execution.ok) {
      step.status = STEP_STATUS.COMPLETED;
      step.result = normalizeResult(execution, limits);
      step.error = null;
      step.finishedAt = nowIso();
      step.durationMs = Date.now() - started;
      step.verification = verifyResult({ answer: step.result.summary, tool: step.tool, ok: true }, { intent: step.type });
      onEvent?.('step_completed', { stepId: step.id, order: step.order, tool: step.tool, attempts: step.attempts, durationMs: step.durationMs });
      return { ok: true, step };
    }

    const failure = classifyFailure(execution.error);
    failure.message = clean(failure.message).slice(0, 200);
    lastFailure = failure;
    if (!failure.retryable) break;
    if (step.attempts < step.maxAttempts) onEvent?.('step_retried', { stepId: step.id, attempt: step.attempts, code: failure.code, category: failure.category });
  }

  step.status = STEP_STATUS.FAILED;
  step.error = lastFailure || { code: 'TOOL_FAILURE', message: 'Arac islemi tamamlanamadi.', category: 'unknown' };
  step.verification = verifyResult({ answer: '', tool: step.tool, ok: false }, { intent: step.type });
  step.finishedAt = nowIso();
  step.durationMs = Date.now() - started;
  onEvent?.('step_failed', { stepId: step.id, order: step.order, tool: step.tool, attempts: step.attempts, code: step.error.code, category: step.error.category });
  return { ok: false, step, failure: lastFailure };
}

module.exports.runStep = runStep;
module.exports.runCompareStep = runCompareStep;
module.exports.runSynthesizeStep = runSynthesizeStep;

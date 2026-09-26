'use strict';

const TASK_STATUS = Object.freeze({
  PENDING: 'pending',
  RUNNING: 'running',
  WAITING: 'waiting',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled'
});

const STEP_STATUS = Object.freeze({
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  SKIPPED: 'skipped',
  BLOCKED: 'blocked'
});

const TASK_TYPES = Object.freeze(['research', 'comparison', 'multi_step_lookup', 'analysis', 'information_gathering']);

const STEP_TYPES = Object.freeze(['tool', 'reason']);

const nowIso = () => new Date().toISOString();
const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
const makeId = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

function createStep(input = {}, { taskId = null, order = 0, maxAttempts = 2, timeoutMs = 15000 } = {}) {
  const dependsOn = Array.isArray(input.dependsOn) ? input.dependsOn.filter(Boolean).map(String) : [];
  return {
    id: clean(input.id) || makeId('step'),
    taskId,
    order,
    type: STEP_TYPES.includes(input.type) ? input.type : 'tool',
    description: clean(input.description) || 'Adım',
    tool: input.tool ? clean(input.tool) : null,
    input: input.input && typeof input.input === 'object' ? input.input : {},
    dependsOn,
    status: STEP_STATUS.PENDING,
    attempts: 0,
    maxAttempts: Number.isFinite(Number(input.maxAttempts)) ? Math.max(1, Math.floor(Number(input.maxAttempts))) : maxAttempts,
    timeoutMs: Number.isFinite(Number(input.timeoutMs)) ? Math.max(1, Math.floor(Number(input.timeoutMs))) : timeoutMs,
    critical: input.critical !== false,
    requiresApproval: Boolean(input.requiresApproval),
    approvalReason: input.approvalReason ? clean(input.approvalReason) : null,
    result: null,
    verification: null,
    error: null,
    startedAt: null,
    finishedAt: null
  };
}

function createTask(input = {}) {
  const created = nowIso();
  return {
    id: clean(input.id) || makeId('task'),
    sessionId: clean(input.sessionId) || 'default',
    goal: clean(input.goal),
    type: TASK_TYPES.includes(input.type) ? input.type : 'information_gathering',
    status: TASK_STATUS.PENDING,
    steps: [],
    currentStep: 0,
    createdAt: created,
    updatedAt: created,
    startedAt: null,
    finishedAt: null,
    result: null,
    error: null,
    requiresApproval: false,
    pendingApproval: null,
    pendingClarification: null,
    requiresClarification: false,
    metadata: input.metadata && typeof input.metadata === 'object' ? input.metadata : {}
  };
}

function summarizeStep(step) {
  if (!step) return null;
  return {
    id: step.id,
    order: step.order,
    type: step.type,
    description: step.description,
    tool: step.tool || null,
    status: step.status,
    attempts: step.attempts,
    maxAttempts: step.maxAttempts,
    dependsOn: step.dependsOn || [],
    verified: step.verification ? Boolean(step.verification.ok) : null,
    requiresApproval: Boolean(step.requiresApproval),
    approvalReason: step.approvalReason || null,
    error: step.error ? { code: step.error.code || null, message: step.error.message || null, category: step.error.category || null } : null,
    summary: step.result ? step.result.summary || null : null,
    updatedAt: step.finishedAt || step.startedAt || null
  };
}

function summarizeTask(task) {
  if (!task) return null;
  const steps = task.steps || [];
  const completed = steps.filter((step) => step.status === STEP_STATUS.COMPLETED).length;
  return {
    taskId: task.id,
    sessionId: task.sessionId,
    type: task.type,
    status: task.status,
    currentStep: task.currentStep || 0,
    totalSteps: steps.length,
    completedSteps: completed,
    requiresApproval: Boolean(task.requiresApproval),
    requiresClarification: Boolean(task.requiresClarification),
    goalLength: (task.goal || '').length,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    finishedAt: task.finishedAt || null,
    error: task.error ? { code: task.error.code || null, message: task.error.message || null } : null
  };
}

function isTerminal(status) {
  return status === TASK_STATUS.COMPLETED || status === TASK_STATUS.FAILED || status === TASK_STATUS.CANCELLED;
}

function findStep(task, stepId) {
  return (task?.steps || []).find((step) => step.id === stepId) || null;
}

function nextRunnableStep(task) {
  const steps = task.steps || [];
  for (const step of steps) {
    if (step.status !== STEP_STATUS.PENDING && step.status !== STEP_STATUS.BLOCKED) continue;
    const ready = (step.dependsOn || []).every((dependency) => findStep(task, dependency)?.status === STEP_STATUS.COMPLETED);
    if (ready) return step;
  }
  return null;
}

function dependencyCycle(plan = {}) {
  const steps = Array.isArray(plan.steps) ? plan.steps : [];
  const byId = new Map(steps.map((step) => [step.id, step]));
  const state = new Map();
  const stack = [];
  const visit = (id) => {
    if (state.get(id) === 'done') return null;
    if (state.get(id) === 'active') return [...stack.slice(stack.indexOf(id)), id];
    state.set(id, 'active');
    stack.push(id);
    for (const dependency of byId.get(id)?.dependsOn || []) {
      if (!byId.has(dependency)) continue;
      const cycle = visit(dependency);
      if (cycle) return cycle;
    }
    stack.pop();
    state.set(id, 'done');
    return null;
  };
  for (const step of steps) {
    const cycle = visit(step.id);
    if (cycle) return cycle;
  }
  return null;
}

module.exports = {
  TASK_STATUS, STEP_STATUS, TASK_TYPES, STEP_TYPES,
  createTask, createStep, summarizeTask, summarizeStep,
  isTerminal, findStep, nextRunnableStep, dependencyCycle
};

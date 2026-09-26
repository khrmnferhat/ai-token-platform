'use strict';

const { createTask, createStep, dependencyCycle } = require('./task');
const { decide, DECISION } = require('./policy');
const { validateInput } = require('../tools/validation');
const { canUse, DEFAULT_ALLOWED } = require('../tools/permissions');
const { countTimeReferences } = require('./periods');

const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
const nowIso = () => new Date().toISOString();
const ALLOWED_STEP_TYPES = new Set(['tool', 'reason']);

// ---------------------------------------------------------------------------
// Plan construction (deterministic; reasoning/planner.js output is reused)
// ---------------------------------------------------------------------------
const { requestedPeriods, PERIOD_LABEL } = require('./periods');

function weatherSteps({ city, period, goal }) {
  // One step per requested period; a rain question adds tomorrow when it is
  // not already requested. Explicit "bugün ... yarın" must never collapse.
  const periods = requestedPeriods(goal, period);
  const wantsRain = /yağ(?:mur|ış)|rain|precipitation/iu.test(goal || '');
  if (wantsRain && !periods.includes('tomorrow')) periods.push('tomorrow');
  const steps = [];
  for (const value of periods.slice(0, 3)) {
    steps.push(createStep({
      type: 'tool', tool: 'weather', description: `${city || 'sehir'} icin ${PERIOD_LABEL[value]} hava durumunu al`,
      input: { city, period: value },
      dependsOn: steps.length ? [steps[steps.length - 1].id] : [],
      order: steps.length, critical: true
    }));
  }
  return steps;
}


function researchSteps({ query, researchPlan, goal }) {
  const wantsComparison = /karşılaştır|karisaltir|compare|fark|avantaj|dezavantaj/iu.test(goal || '');
  const wantsSummary = /özet|summary|kısaca|sonuç|raporla/iu.test(goal || '');
  const steps = [createStep({
    type: 'tool', tool: 'research', description: `Arastir: ${query}`,
    input: researchPlan ? { query, plan: researchPlan } : { query }, order: 0, critical: true
  })];
  if (wantsComparison) {
    steps.push(createStep({
      type: 'reason', tool: null, description: 'Kaynaklari karsilastir ve farklari cikar',
      input: { mode: 'compare' }, dependsOn: [steps[0].id], order: steps.length, critical: true
    }));
  }
  if (wantsSummary || wantsComparison) {
    const parent = steps[steps.length - 1].id;
    steps.push(createStep({
      type: 'reason', tool: null, description: 'Dogrulanmis bulgulardan yaniti sentezle',
      input: { mode: 'synthesize' }, dependsOn: [parent], order: steps.length, critical: true
    }));
  }
  return steps;
}

// Capabilities the user can ask for in a goal. Used ONLY to detect that a
// request went unanswered, so the agent never claims a completion it did not
// achieve. It never adds steps.
const CAPABILITY_SIGNAL = {
  currency: /dolar|euro|sterlin|\busd\b|\beur\b|\bgbp\b|kuru?\b|exchange\s+rate/iu
};

function buildPlan({ goal, detection, intelligence = {}, reasoning = {}, context = {}, maxSteps = 8, maxAttempts = 2, timeoutMs = 15000, sessionId = 'default' } = {}) {
  const text = clean(goal);
  const taskType = detection?.taskType || 'information_gathering';
  const city = intelligence.entities?.city || context.weatherCity || null;
  const period = intelligence.entities?.period || 'today';
  let steps = [];
  let metadata = { city, period, query: null, researchPlan: reasoning.researchPlan || null };

  // A period-only request ("Yarın ve hafta sonunu karşılaştır.") in a session that
  // already has a weather city is a weather follow-up, not web research.
  const weatherFollowUp = Boolean(context.weatherCity) && /bug[üu]n|yar[ıi]n|hafta\s+sonu/iu.test(text);
  if (intelligence.intent === 'weather' || /hava|yağmur|yağış|sıcaklık|rüzgâr/iu.test(text) || weatherFollowUp) {
    steps = weatherSteps({ city, period, goal: text });
  } else {
    const query = reasoning.researchPlan?.objective || intelligence.entities?.query || text;
    metadata = { ...metadata, query, researchPlan: reasoning.researchPlan || null };
    steps = researchSteps({ query, researchPlan: reasoning.researchPlan, goal: text });
  }

  const trimmed = steps.slice(0, maxSteps).map((step, index) => ({ ...step, order: index }));
  // Anything the goal asked for that no planned step can serve.
  const plannedTools = new Set(trimmed.map((step) => step.tool).filter(Boolean));
  const unaddressed = Object.keys(CAPABILITY_SIGNAL)
    .filter((capability) => !plannedTools.has(capability) && CAPABILITY_SIGNAL[capability].test(text));
  const task = createTask({
    sessionId,
    goal: text,
    type: taskType,
    metadata: {
      ...metadata,
      unaddressed,
      detection: { reason: detection?.reason || null, confidence: detection?.confidence || 0, signals: detection?.signals || {} },
      reasoning: { taskType: reasoning.taskType || null, researchDepth: reasoning.researchDepth || null }
    }
  });
  task.steps = trimmed.map((step) => createStep(step, { taskId: task.id, order: step.order, maxAttempts, timeoutMs }));
  return task;
}

// ---------------------------------------------------------------------------
// Plan validation - an LLM-authored plan is NEVER executed without this pass
// ---------------------------------------------------------------------------
function validatePlan(task, { registry, limits = {}, allowedCapabilities = DEFAULT_ALLOWED } = {}) {
  const issues = [];
  const push = (code, message, stepId = null) => issues.push({ code, message, stepId });
  const steps = task?.steps || [];
  const maxSteps = limits.maxSteps || 8;
  const maxAttempts = limits.maxAttemptsPerStep || 2;
  const maxDuration = limits.maxTaskDurationMs || 60000;

  if (!steps.length) push('EMPTY_PLAN', 'Plan en az bir adim icermeli.');
  if (steps.length > maxSteps) push('TOO_MANY_STEPS', `Plan ${steps.length} adim iceriyor; sinir ${maxSteps}.`);

  const ids = new Set();
  for (const step of steps) {
    if (ids.has(step.id)) push('DUPLICATE_STEP_ID', `Tekrarlanan adim kimligi: ${step.id}`, step.id);
    ids.add(step.id);
  }

  for (const step of steps) {
    if (!ALLOWED_STEP_TYPES.has(step.type)) push('INVALID_STEP_TYPE', `Gecersiz adim turu: ${step.type}`, step.id);
    if (step.maxAttempts < 1 || step.maxAttempts > maxAttempts) push('INVALID_MAX_ATTEMPTS', `Adim deneme sayisi gecersiz: ${step.maxAttempts}`, step.id);
    if (step.timeoutMs < 1 || step.timeoutMs > maxDuration) push('INVALID_TIMEOUT', `Adim zaman asimi gecersiz: ${step.timeoutMs}`, step.id);
    for (const dependency of step.dependsOn || []) {
      if (!ids.has(dependency)) push('UNKNOWN_DEPENDENCY', `Bilinmeyen bagimlilik: ${dependency}`, step.id);
      if (dependency === step.id) push('SELF_DEPENDENCY', `Adim kendine bagli: ${step.id}`, step.id);
    }
    if (step.type !== 'tool') continue;

    const tool = registry?.get?.(step.tool);
    if (!tool) { push('UNKNOWN_TOOL', `Arac bulunamadi: ${step.tool}`, step.id); continue; }
    if (tool.enabled === false) push('TOOL_DISABLED', `Arac devre disi: ${step.tool}`, step.id);
    if (!canUse(tool, null, allowedCapabilities)) push('PERMISSION_DENIED', `Arac icin izin yok: ${step.tool}`, step.id);

    const policy = decide({ tool, stepType: 'tool' });
    if (policy.decision === DECISION.DENY) { push('DANGEROUS_ACTION', `Tehlikeli arac engellendi: ${step.tool}`, step.id); continue; }
    if (policy.decision === DECISION.ASK) {
      step.requiresApproval = true;
      step.approvalReason = step.approvalReason || policy.approvalReason;
    }

    // Required-field PRESENCE is classified first. An absent value is a
    // clarification need (spec 16), never a schema violation.
    const missingKeys = (tool.inputSchema?.required || []).filter((key) => {
      const value = step.input?.[key];
      return value === undefined || value === null || (typeof value === 'string' && !value.trim());
    });
    for (const key of missingKeys) push('MISSING_REQUIRED_INPUT', `${step.tool} icin "${key}" gerekli.`, step.id);

    // INVALID_INPUT_SCHEMA is reserved for fields the user actually supplied
    // with the wrong type, so it stays a blocking issue (PLAN_REJECTED).
    const validation = validateInput(step.input, tool.inputSchema);
    if (!validation.ok) {
      const schemaErrors = validation.errors.filter((error) => !missingKeys.some((key) => {
        const token = `.${key}`;
        const at = error.indexOf(token);
        if (at < 0) return false;
        const after = error.charAt(at + token.length);
        return after === '' || after === ' ' || after === '.';
      }));
      if (schemaErrors.length) push('INVALID_INPUT_SCHEMA', `Gecersiz girdi (${step.tool}): ${schemaErrors.join(', ')}`, step.id);
    }
  }

  const cycle = dependencyCycle({ steps });
  if (cycle) push('DEPENDENCY_CYCLE', `Bagimlilik dongusu: ${cycle.join(' -> ')}`);

  if (issues.length) return { ok: false, code: 'PLAN_REJECTED', issues, plan: task };
  return { ok: true, code: 'PLAN_VALIDATED', issues: [], plan: task, validatedAt: nowIso() };
}

module.exports = { buildPlan, validatePlan, weatherSteps, researchSteps, ALLOWED_STEP_TYPES };


'use strict';

const path = require('node:path');
const { detectTask } = require('./detect');
const { buildPlan, validatePlan } = require('./planner');
const { TASK_STATUS, STEP_STATUS, summarizeTask, summarizeStep, isTerminal, findStep, nextRunnableStep } = require('./task');
const { decideClarification } = require('./policy');
const { validateInput } = require('../tools/validation');
const { runStep, stepPayload } = require('./executor');
const { decideRecovery, failureSignature, ACTION } = require('./recovery');
const { TaskStateStore } = require('./state');
const { AgentEventLog } = require('./events');
const { resolveLimits } = require('./limits');

const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
const nowIso = () => new Date().toISOString();

// Replies that are clearly not an answer to a clarification question.
const NON_VALUE = new Set([
  'merhaba', 'selam', 'selamlar', 'hello', 'hi', 'hey', 'günaydın', 'gunaydin', 'iyi geceler',
  'teşekkür', 'teşekkürler', 'tesekkur', 'tesekkurler', 'sağol', 'sagol', 'sağ ol',
  'tamam', 'ok', 'okay', 'evet', 'hayır', 'hayir', 'peki', 'anladım', 'anladim', 'anlıyorum',
  'süper', 'super', 'harika', 'mükemmel', 'iyi', 'oldu', 'devam', 'sonra', 'bir de', 'ayrıca', 'ayrica',
  'bekliyorum', 'lütfen', 'lutfen', 'yardım', 'yardim', 'help', 'yes', 'no', 'thanks', 'thank you'
]);
// Wording that indicates the user is ASKING something, not answering.
const REQUEST_WORDING = /\b(nedir|neden|nerede|hangi|kaç|kac|ne\s+kadar|nasıl|nasil|ne\s+yap|ne\s+ol|ne\s+demek|bakabilir|haber|incele|araştır|arastir|kontrol|ekle|çıkar|cikar|değiştir|degistir|listele|özetle|ozetle)\b/iu;
// Tool rejections that mean "the value you gave me is not usable", as opposed to
// an infrastructure or permission failure.
const UNUSABLE_VALUE = /CITY_NOT_FOUND|INVALID_TOOL_INPUT|QUERY_REQUIRED|CITY_REQUIRED|BASE_REQUIRED|QUOTE_REQUIRED/i;

// How many times the same failure signature may repeat across a whole task.
function failureBudget(task, signature, limit) {
  return (task.failureSignatures || []).filter((item) => item.signature === signature).length < limit;
}

class AgentRuntime {
  constructor({ toolLayer, stateFile, limits = {}, eventLog = null, maxRetainedTasks } = {}) {
    this.tools = toolLayer;
    this.registry = toolLayer?.registry || null;
    this.router = toolLayer?.router || null;
    this.limits = resolveLimits(limits);
    const file = stateFile || process.env.V6_TASK_FILE || path.join(__dirname, '..', 'data', 'tasks.json');
    this.store = new TaskStateStore(file, maxRetainedTasks ? { maxRetainedTasks } : {});
    this.events = eventLog || new AgentEventLog();
  }

  emit(type, taskId, payload) { return this.events.emit(type, taskId, payload); }

  // A bare reply ("Gaziantep.") to a pending clarification continues the SAME
  // task. Conservative: only a waiting task for THIS session, only when the
  // message is a short bare value, never when the message is its own request.
  //
  // The reply must also look like a VALUE. Without this, "Merhaba",
  // "Teşekkürler" or "Dolar kuru nedir" were consumed as the city and the
  // waiting task was destroyed with CITY_NOT_FOUND.
  answerFitsClarification(message, pending, detection) {
    if (!pending?.pendingClarification) return false;
    if (detection?.agentic || detection?.signals?.risk) return false;
    if (detection?.reason === 'memory_action') return false;
    const value = String(message || '').trim();
    if (!value || value.length > 60) return false;
    if (/[?？]/.test(value)) return false;
    if (value.split(/\s+/).filter(Boolean).length > 4) return false;
    const flat = value.toLocaleLowerCase('tr-TR').replace(/[.!?,;:]+$/u, '').replace(/\s+/g, ' ').trim();
    if (!flat) return false;
    if (NON_VALUE.has(flat)) return false;
    // Question/request wording means the user is asking something, not answering.
    if (REQUEST_WORDING.test(flat)) return false;
    return true;
  }

  // Delegates to the ONE existing resume implementation; never a second one.
  async resumePendingClarification({ message, sessionId, detection }) {
    const pending = this.store.findResumable(sessionId);
    if (!pending || !this.answerFitsClarification(message, pending, detection)) return null;
    const outcome = await this.resume(pending.id, { answer: message });
    if (!outcome?.task) return null;              // failed/not-resumable: normal path
    return {
      agentic: true, resumed: true, detection, task: outcome.task,
      summary: summarizeTask(outcome.task), answer: outcome.answer,
      result: outcome.task.result, verification: outcome.verification
    };
  }

  // Entry point: detect -> plan -> validate -> execute
  async handle({ message, sessionId = 'default', intelligence = {}, reasoning = {}, context = {}, decision = null, approved = false } = {}) {
    const detection = detectTask(message, { intelligence, reasoning, context, decision });
    if (!detection.agentic) {
      const continued = await this.resumePendingClarification({ message, sessionId, detection });
      if (continued) return continued;
      return { agentic: false, detection };
    }
    const planned = this.plan({ message, sessionId, intelligence, reasoning, context, detection });
    const outcome = await this.execute(planned.task, { approved });
    return {
      agentic: true, resumed: false, detection, task: outcome.task, summary: summarizeTask(outcome.task),
      answer: outcome.answer, result: outcome.task.result, verification: outcome.verification
    };
  }

  plan({ message, sessionId, intelligence, reasoning, context, detection }) {
    const task = buildPlan({
      goal: message, detection, intelligence, reasoning, context, sessionId,
      maxSteps: this.limits.maxSteps, maxAttempts: this.limits.maxAttemptsPerStep, timeoutMs: this.limits.stepTimeoutMs
    });
    this.emit('task_created', task.id, { sessionId, type: task.type, steps: task.steps.length, goal: task.goal, detectionReason: detection?.reason });
    const validation = validatePlan(task, { registry: this.registry, limits: this.limits });

    // Missing required information is a CLARIFICATION gate, not a hard reject.
    const missingIssues = validation.issues.filter((issue) => issue.code === 'MISSING_REQUIRED_INPUT');
    const blocking = validation.issues.filter((issue) => issue.code !== 'MISSING_REQUIRED_INPUT');
    if (missingIssues.length && !blocking.length) {
      const fields = [...new Set(missingIssues.map((issue) => (issue.message.match(/"([^"]+)"/) || [])[1]).filter(Boolean))];
      const gate = decideClarification({ missing: fields });
      task.status = TASK_STATUS.WAITING;
      task.requiresClarification = true;
      task.pendingClarification = {
        fields, stepId: missingIssues[0].stepId || null,
        question: gate.question,
        askedAt: nowIso()
      };
      this.emit('task_waiting', task.id, { reason: 'clarification', fields });
      this.store.put(task);
      return { task, validation: { ok: true, code: 'CLARIFICATION_REQUIRED', issues: validation.issues }, gate };
    }
    if (!validation.ok) {
      task.status = TASK_STATUS.FAILED;
      task.error = { code: 'PLAN_REJECTED', message: 'Plan dogrulamasi basarisiz.', issues: validation.issues };
      this.emit('plan_rejected', task.id, { code: 'PLAN_REJECTED', issueCodes: validation.issues.map((issue) => issue.code) });
      this.store.put(task);
      return { task, validation, gate: null };
    }
    task.status = TASK_STATUS.PENDING;
    this.emit('task_planned', task.id, { steps: task.steps.length, tools: task.steps.map((step) => step.tool).filter(Boolean) });
    this.store.put(task);
    return { task, validation, gate: null };
  }

  // Bounded execution loop with loop protection (spec 30/31)
  async execute(task, { approved = false } = {}) {
    if (isTerminal(task.status) || task.status === TASK_STATUS.WAITING) {
      return { task, answer: this.answerFrom(task), verification: this.verificationFor(task) };
    }
    const startedAt = Date.now();
    task.status = TASK_STATUS.RUNNING;
    task.startedAt = task.startedAt || nowIso();
    task.failureSignatures = task.failureSignatures || [];
    let toolCalls = 0;

    while (true) {
      if (Date.now() - startedAt > this.limits.maxTaskDurationMs) { this.abortTask(task, 'max_task_duration', 'Gorev sure limiti asildi.'); break; }
      const step = nextRunnableStep(task);
      if (!step) break;
      if (toolCalls + step.maxAttempts > this.limits.maxToolCalls) { this.abortTask(task, 'max_tool_calls', 'Arac cagri limiti asildi.'); break; }
      task.currentStep = step.order;

      const outcome = await runStep(step, task, {
        router: this.router, registry: this.registry, limits: this.limits,
        onEvent: (type, payload) => this.emit(type, task.id, payload), approved
      });
      if (step.type === 'tool') toolCalls += step.attempts;
      this.store.put(task);

      if (outcome.ok) continue;

      if (outcome.blocked && outcome.requiresApproval) {
        task.status = TASK_STATUS.WAITING;
        task.requiresApproval = true;
        task.pendingApproval = { stepId: step.id, reason: outcome.approvalReason, tool: step.tool, description: step.description, askedAt: nowIso() };
        this.emit('task_waiting', task.id, { reason: 'approval', tool: step.tool, approvalReason: outcome.approvalReason });
        this.store.put(task);
        return { task, answer: this.answerFrom(task), verification: this.verificationFor(task) };
      }

      const failure = outcome.failure || { category: 'unknown', code: step.error?.code, message: step.error?.message };
      const signature = failureSignature(failure);
      task.failureSignatures.push({ signature, stepId: step.id, at: nowIso() });
      if (!failureBudget(task, signature, this.limits.maxIdenticalFailureSignatures)) { this.failTask(task, step, failure, 'repeated_identical_failure'); break; }

      const alternative = step.type === 'tool' ? this.findAlternative(step) : null;
      const recovery = decideRecovery({ failure, attempts: step.attempts, maxAttempts: step.maxAttempts, hasAlternative: Boolean(alternative), critical: step.critical });

      if (recovery.action === ACTION.RETRY) continue;
      if (recovery.action === ACTION.CLARIFY) {
        task.status = TASK_STATUS.WAITING;
        task.requiresClarification = true;
        task.pendingClarification = { fields: [step.tool], question: step.error?.message || 'Eksik bilgi var.', stepId: step.id, askedAt: nowIso() };
        this.emit('task_waiting', task.id, { reason: 'clarification', stepId: step.id });
        this.store.put(task);
        return { task, answer: this.answerFrom(task), verification: this.verificationFor(task) };
      }
      if (recovery.action === ACTION.ALTERNATIVE && alternative) {
        step.tool = alternative; step.attempts = 0; step.status = STEP_STATUS.PENDING; step.error = null;
        this.emit('step_retried', task.id, { stepId: step.id, code: failure.code, alternative });
        this.store.put(task);
        continue;
      }
      if (recovery.action === ACTION.SKIP) {
        step.status = STEP_STATUS.SKIPPED;
        this.emit('step_skipped', task.id, { stepId: step.id, code: failure.code });
        this.store.put(task);
        continue;
      }
      this.failTask(task, step, failure, recovery.reason);
      break;
    }
    return this.finalize(task);
  }

  // Completion gate (spec 22): the LLM never decides "done".
  finalize(task) {
    const done = (task.steps || []).filter((step) => step.status === STEP_STATUS.COMPLETED);
    const failed = (task.steps || []).filter((step) => step.status === STEP_STATUS.FAILED);
    if (task.status === TASK_STATUS.RUNNING) {
      if (!done.length || failed.some((step) => step.critical)) {
        task.status = failed.length ? TASK_STATUS.FAILED : TASK_STATUS.WAITING;
        task.error = failed.length ? { code: 'TASK_INCOMPLETE', message: 'Kritik adimlar tamamlanamadi.' } : { code: 'NO_RESULTS', message: 'Uretilebilir sonuc yok.' };
      } else {
        task.status = TASK_STATUS.COMPLETED;
      }
    }
    task.finishedAt = nowIso();
    task.result = this.buildResult(task);
    if (task.status === TASK_STATUS.COMPLETED) this.emit('task_completed', task.id, { steps: done.length, type: task.type, goal: task.goal });
    else if (task.status === TASK_STATUS.FAILED) this.emit('task_failed', task.id, { code: task.error?.code });
    this.store.put(task);
    return { task, answer: this.answerFrom(task), verification: this.verificationFor(task) };
  }

  // An alternative must be RELATED to the failed tool AND able to accept the
  // same input. Generic capabilities (read/search/external) are shared by every
  // tool, so they are only considered last; an input-incompatible tool must
  // never be substituted.
  findAlternative(step) {
    if (!this.registry || !step.tool) return null;
    const tool = this.registry.get(step.tool);
    if (!tool) return null;
    const capabilities = Array.isArray(tool.capabilities) ? tool.capabilities : [];
    const GENERIC = new Set(['read', 'search', 'external']);
    const ordered = [
      ...capabilities.filter((capability) => !GENERIC.has(capability)),
      ...capabilities.filter((capability) => GENERIC.has(capability))
    ];
    const compatible = (candidate) => {
      if (!candidate || candidate.name === step.tool || candidate.enabled === false) return false;
      return validateInput(step.input, candidate.inputSchema).ok;
    };
    for (const capability of ordered) {
      const candidate = (this.registry.findByCapability(capability) || []).find(compatible);
      if (candidate) return candidate.name;
    }
    return null;
  }

  failTask(task, step, failure, reason) {
    task.status = TASK_STATUS.FAILED;
    task.error = { code: String(failure.code || 'STEP_FAILED').toUpperCase(), message: clean(failure.message || reason).slice(0, 300), reason, category: failure.category || null, stepId: step?.id || null };
  }

  abortTask(task, code, message) {
    task.status = TASK_STATUS.FAILED;
    task.error = { code, message };
  }

  // Deterministic natural answer built ONLY from compressed evidence (spec 23).
  answerFrom(task) {
    if (task.status === TASK_STATUS.WAITING) {
      if (task.pendingApproval) return `Bu islemi calistirmam icin onayin gerekiyor: ${task.pendingApproval.description || task.pendingApproval.tool}. Onay vermedigin icin hicbir sey calistirilmadi.`;
      return (task.pendingClarification?.question) || 'Devam etmek icin biraz daha bilgiye ihtiyacim var.';
    }
    const done = (task.steps || []).filter((step) => step.status === STEP_STATUS.COMPLETED && step.result?.summary);
    if (!done.length) return task.error?.message || 'Bu gorev icin guvenilir veri uretilemedi.';
    const answer = done.map((step) => step.result.summary).join(' ').replace(/\s+/g, ' ').trim();
    // Never present a partial result as a complete one.
    const missed = task.metadata?.unaddressed || [];
    return missed.length ? `${answer} Not: ${missed.join(' ve ')} bilgisi bu adımda alınamadı.` : answer;
  }

  buildResult(task) {
    const completed = (task.steps || []).filter((step) => step.status === STEP_STATUS.COMPLETED);
    const researchStep = completed.find((step) => step.tool === 'research');
    const research = researchStep?.result?.normalized || null;
    return {
      answer: this.answerFrom(task),
      steps: completed.length,
      toolCalls: completed.reduce((total, step) => total + (step.type === 'tool' ? step.attempts : 0), 0),
      stepResults: completed.map(stepPayload),
      ...(research ? { sources: research.sources || [], claims: research.claims || [], evidence: research.evidence || research.claims || [], contradictions: research.contradictions || [] } : {})
    };
  }

  verificationFor(task) {
    const steps = task.steps || [];
    const failedCritical = steps.filter((step) => step.critical && step.status === STEP_STATUS.FAILED);
    const unverified = steps.filter((step) => step.status === STEP_STATUS.COMPLETED && !step.verification?.ok);
    // A request the plan could not fully serve is not a verified success.
    const unaddressed = task.metadata?.unaddressed || [];
    const ok = task.status === TASK_STATUS.COMPLETED && !failedCritical.length && !unverified.length && !unaddressed.length;
    return {
      ok,
      mode: 'agent_task',
      reason: task.status === TASK_STATUS.COMPLETED
        ? (unaddressed.length ? 'partial_coverage' : unverified.length ? 'step_not_verified' : 'all_steps_verified')
        : task.status === TASK_STATUS.WAITING ? 'awaiting_user' : 'task_incomplete',
      unaddressed,
      stepsVerified: steps.filter((step) => step.verification?.ok).length,
      stepsFailed: steps.filter((step) => step.status === STEP_STATUS.FAILED).length,
      verifiedSteps: steps.filter((step) => step.verification).length,
      totalSteps: steps.length,
      checkedAt: nowIso()
    };
  }

  // Continuation / resume / cancel (spec 13, 16, 17)
  async resume(taskId, { answer = null, approved = false } = {}) {
    const task = this.store.get(taskId);
    if (!task) return { ok: false, error: 'TASK_NOT_FOUND' };
    if (isTerminal(task.status)) return { ok: false, error: 'TASK_ALREADY_FINISHED', summary: summarizeTask(task) };
    if (task.status !== TASK_STATUS.WAITING) return { ok: false, error: 'TASK_NOT_WAITING', summary: summarizeTask(task) };

    const pendingApproval = task.pendingApproval;
    const pendingClarification = task.pendingClarification;
    task.pendingApproval = null;
    task.pendingClarification = null;
    task.requiresApproval = false;
    task.requiresClarification = false;
    task.status = TASK_STATUS.PENDING;
    this.emit('task_resumed', task.id, { hadApproval: Boolean(pendingApproval), hadClarification: Boolean(pendingClarification) });

    if (pendingApproval) {
      const step = findStep(task, pendingApproval.stepId);
      if (step && approved) { step.attempts = 0; step.status = STEP_STATUS.PENDING; step.requiresApproval = false; step.error = null; }
      else if (step && !approved) {
        this.failTask(task, step, { code: 'APPROVAL_DENIED', message: 'Kullanici onayi vermedi.', category: 'permission' }, 'approval_denied');
        task.finishedAt = nowIso();
        this.store.put(task);
        this.emit('task_cancelled', task.id, { reason: 'approval_denied' });
        return { ok: false, error: 'APPROVAL_DENIED', task, summary: summarizeTask(task) };
      }
    }
    if (pendingClarification && answer) {
      const field = pendingClarification.fields?.[0];
      // A conversational reply carries sentence punctuation ("Gaziantep."); that
      // is never part of the value, and it breaks strict tool inputs.
      const value = clean(answer).replace(/[.!?;:,\s]+$/u, '');
      // The answer applies to EVERY tool step that is still missing it, not just
      // the step that raised the clarification (a plan may share the field).
      for (const step of task.steps || []) {
        if (step.type !== 'tool') continue;
        if (field && !step.input?.[field]) step.input = { ...step.input, [field]: value };
        step.attempts = 0;
        step.status = STEP_STATUS.PENDING;
        step.error = null;
      }
    }
    this.store.put(task);
    const outcome = await this.execute(task, { approved });
    this.reopenClarification(outcome.task, pendingClarification);
    return { ok: outcome.task.status === TASK_STATUS.COMPLETED, task: outcome.task, summary: summarizeTask(outcome.task), answer: outcome.answer, verification: outcome.verification };
  }

  // A clarification answer the tool rejects ("asdfghjkl.") is not a failed
  // task: the user simply gave an unusable value. Re-ask on the SAME task
  // instead of destroying it, so a typo never costs the whole request.
  reopenClarification(task, pendingClarification) {
    if (!pendingClarification || !task) return;
    if (task.status !== TASK_STATUS.FAILED) return;
    if ((task.steps || []).some((step) => step.status === STEP_STATUS.COMPLETED)) return;
    // Only when the value the user supplied is what the tool rejected.
    if (!UNUSABLE_VALUE.test(String(task.error?.code || ''))) return;
    const field = pendingClarification.fields?.[0];
    if (!field) return;
    for (const step of task.steps || []) {
      if (step.type === 'tool' && step.input && field in step.input) step.input[field] = null;
      step.attempts = 0;
      step.status = STEP_STATUS.PENDING;
      step.error = null;
      step.verification = null;
    }
    task.status = TASK_STATUS.WAITING;
    task.requiresClarification = true;
    task.error = null;
    task.result = null;
    task.finishedAt = null;
    task.pendingClarification = { ...pendingClarification, askedAt: nowIso() };
    this.emit('task_waiting', task.id, { reason: 'clarification_retry', fields: [field] });
    this.store.put(task);
  }

  cancel(taskId) {
    const task = this.store.get(taskId);
    if (!task) return { ok: false, error: 'TASK_NOT_FOUND' };
    if (isTerminal(task.status)) return { ok: false, error: 'TASK_ALREADY_FINISHED', summary: summarizeTask(task) };
    task.status = TASK_STATUS.CANCELLED;
    task.finishedAt = nowIso();
    for (const step of task.steps || []) if ([STEP_STATUS.PENDING, STEP_STATUS.RUNNING, STEP_STATUS.BLOCKED].includes(step.status)) step.status = STEP_STATUS.SKIPPED;
    this.emit('task_cancelled', task.id, { type: task.type, goal: task.goal });
    this.store.put(task);
    return { ok: true, task, summary: summarizeTask(task) };
  }

  get(taskId) {
    const task = this.store.get(taskId);
    return task
      ? { ok: true, task, summary: summarizeTask(task), steps: (task.steps || []).map(summarizeStep), events: this.events.forTask(taskId) }
      : { ok: false, error: 'TASK_NOT_FOUND' };
  }

  list(options = {}) { return this.store.list(options).map(summarizeTask); }
}

module.exports = { AgentRuntime, summarizeTask, summarizeStep, TASK_STATUS, STEP_STATUS, nextRunnableStep, failureBudget };

'use strict';

const path = require('node:path');
const { periodFromText } = require('../tools/weather');
const { createToolLayer } = require('../tools');
const { buildContext, updateContext, promptContext } = require('./context');
const { classifyIntent } = require('./intent');
const { decide, legacyRoute } = require('./decision');
const { verifyResult } = require('./verifier');
const { MemoryStore } = require('../memory/store');
const { ExperienceJournal } = require('../memory/experience');
const { detectSubject } = require('../memory/retrieval');
const { containsPreference } = require('../memory/identity');
const { planReasoning } = require('../reasoning/planner');
const { Learner, summarizeLesson } = require('../learning');
const { AgentRuntime, summarizeTask } = require('../agent');


const OLLAMA_URL = String(process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/+$/, '');
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen3:1.7b';
const OLLAMA_TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS) || 120000;
const text = (value) => String(value || '').trim();
const lower = (value) => text(value).toLocaleLowerCase('tr-TR');
const title = (value) => { const result = text(value); return result ? result.charAt(0).toLocaleUpperCase('tr-TR') + result.slice(1) : result; };
const summary = (record) => record ? {
  id: record.id, type: record.type, content: record.content || record.text, confidence: record.confidence,
  source: record.source, createdAt: record.createdAt, updatedAt: record.updatedAt, validFrom: record.validFrom,
  validUntil: record.validUntil, importance: record.importance,
  ...(record.relevanceScore === undefined ? {} : { relevanceScore: record.relevanceScore }),
  ...(record.type === 'experience' ? { action: record.action, context: record.context, outcome: record.outcome, success: record.success, uses: record.uses, successes: record.successes, failures: record.failures, lastUsedAt: record.lastUsedAt, lastSuccessAt: record.lastSuccessAt, lastFailureAt: record.lastFailureAt } : {})
} : null;
const toolSummary = (execution) => execution ? { name: execution.tool, ok: execution.ok, source: execution.metadata?.source || null, durationMs: execution.metadata?.durationMs ?? null, fetchedAt: execution.metadata?.fetchedAt || null, error: execution.error || null } : null;
const isCorrection = (message) => /yanlış anlad|yanlış anlat|aslında|demek istediğim|hayır\b.*tercih|hayır\s*[,.]?\s*bu/i.test(lower(message));
// Task ids are generated as "task-<ts>-<rand>"; only that shape is accepted.
const isTaskId = (value) => /^task-[0-9]{10,}-[a-z0-9]{4,12}$/i.test(String(value || '').trim());

function fallbackAnswer(message, context) {
  if (/hava|yağmur|sıcaklık|rüzgâr|bulut/.test(lower(message))) return 'Güzel! Bugün hava gerçekten keyifli görünüyor.';
  if (context.facts?.length) return 'Önceki konuşmadan alakalı bilgileri kullanıyorum.';
  return 'Sardis seni dinliyorum. Devam edebiliriz.';
}
function recallAnswer(query, relevant, identity) {
  const value = lower(query);
  if (/ad[ıi]m|isim|my name/.test(value) && identity?.name) return `Adının ${title(identity.name)} olduğunu hatırlıyorum.`;
  const subject = relevant.map((item) => detectSubject(item.content)).find(Boolean);
  if (/işletim|operating|\bos\b/.test(value) && subject?.key === 'operating_system') return `${title(subject.value)} kullandığını hatırlıyorum.`;
  if (relevant.length) return `Bunu hatırlıyorum: ${relevant[0].content}`;
  return null;
}

class Sardis {
  constructor({ memoryFile = process.env.V6_MEMORY_FILE || path.join(__dirname, '..', 'data', 'state.json'), toolLayer = null, agentRuntime = null, taskFile = null } = {}) {
    this.memory = new MemoryStore(memoryFile);
    this.tools = toolLayer || createToolLayer();
    this.experience = new ExperienceJournal(this.memory);
    this.learner = new Learner(this.memory);
    this.agent = agentRuntime || new AgentRuntime({ toolLayer: this.tools, stateFile: taskFile || process.env.V6_TASK_FILE || path.join(__dirname, '..', 'data', 'tasks.json') });
    this.model = OLLAMA_MODEL;
    this.baseUrl = OLLAMA_URL;
  }
  isValidTaskId(value) { return isTaskId(value); }
  sessions() { return this.memory.listSessions(); }
  session(id) { return this.memory.getSession(id); }
  newConversation(id) {
    const key = id || `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.memory.removeSession(key); this.memory.getSession(key); return key;
  }
  route(message, context = {}) { const intelligence = classifyIntent(message, context); return legacyRoute({ ...intelligence, ...planReasoning(message, intelligence, context) }, context); }
  async ollama(messages, signal) {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: this.model, messages, stream: false, think: false, options: { temperature: 0.45, num_predict: 220 } }),
      signal: signal || AbortSignal.timeout(OLLAMA_TIMEOUT_MS)
    });
    if (!response.ok) throw new Error(`Ollama HTTP ${response.status}`);
    const data = await response.json();
    return data?.message?.content || data?.response || '';
  }

  async chat(sessionId, message, options = {}) {
    const id = this.memory.normalizeId(sessionId || 'default');
    const clean = text(message).replace(/\s+/g, ' ');
    if (!clean) return { ok: false, error: 'message_required' };
    const before = this.memory.getSession(id);
    const identityBefore = this.memory.identity();
    const relevant = this.memory.retrieve(clean, { limit: 5 });
    const context = buildContext(before, relevant, identityBefore, clean);
    const intelligence = classifyIntent(clean, context);
    const reasoning = planReasoning(clean, intelligence, context);
    const effectiveIntelligence = { ...intelligence, ...reasoning, entities: { ...(intelligence.entities || {}), ...(reasoning.entities || {}) } };
    const decision = decide(effectiveIntelligence);
    const relevantLessons = this.learner.retrieve(clean, { topic: intelligence.topic, intent: intelligence.intent, task: reasoning.taskType, tool: decision.tool || null });
    context.learning = { relevantLessons: relevantLessons.map(summarizeLesson) };
    const route = legacyRoute(effectiveIntelligence, context);
    this.memory.addMessage(id, 'user', clean);
    let result;
    let pendingMemory = null;

    // Agentic layer: runs only when the request is a genuine multi-step task.
    // Everything below is the untouched non-agentic path.
    const agentOutcome = await this.agent.handle({ message: clean, sessionId: id, intelligence, reasoning, context, decision });
    if (agentOutcome.agentic) {
      result = this.agentResult(agentOutcome, { reasoning, intelligence, effectiveIntelligence });
    } else if (decision.action === 'clarify') {
      const answer = decision.type === 'weather' ? 'Hava için hangi şehri takip edeyim?' : reasoning.questions?.length ? reasoning.questions.join(' ') : 'Bu konuda biraz daha net olabilir misin?';
      result = { ok: true, answer, route: decision.type, action: 'clarify', tool: null, requiresClarification: true, reasoning };
    } else if (decision.action === 'memory') {
      const requested = intelligence.entities?.memory || before.context?.entities?.memory || '';
      if (intelligence.memoryOperation === 'forget') {
        result = { ok: true, answer: requested ? 'Tamam, bunu unuttum.' : 'Neyi unutmamı istediğini belirtmedin.', route: 'memory', action: 'memory', tool: null, memory: { operation: 'forget' } };
        pendingMemory = { operation: 'forget', value: requested };
      } else {
        const value = requested || 'Kullanıcı bu konuşma bağlamını hatırlamak istedi.';
        result = { ok: true, answer: 'Tamam, bunu hatırlayacağım.', route: 'memory', action: 'memory', tool: null, memory: { operation: 'remember' } };
        pendingMemory = { operation: 'remember', value };
      }
    } else if (decision.action === 'tool' && decision.type === 'weather') {
      const city = intelligence.entities?.city || context.weatherCity || route.city;
      const period = intelligence.entities?.period || periodFromText(clean);
      const execution = await this.tools.router.execute('weather', { city, period }, { capability: 'weather' });
      const tool = execution.data || {};
      result = { ok: execution.ok, answer: tool.answer || tool.detail || execution.error?.message || 'Hava bilgisi alınamadı.', route: 'weather', action: 'tool', tool: 'weather', toolResult: tool, toolExecution: toolSummary(execution), error: execution.error || null };
    } else if (decision.action === 'tool' && decision.type === 'currency') {
      const pair = intelligence.entities?.currency || route;
      const execution = await this.tools.router.execute('currency', { base: pair.base, quote: pair.quote }, { capability: 'currency' });
      const tool = execution.data || {};
      result = { ok: execution.ok, answer: tool.answer || tool.detail || execution.error?.message || 'Kur bilgisi alınamadı.', route: 'currency', action: 'tool', tool: 'currency', toolResult: tool, toolExecution: toolSummary(execution), error: execution.error || null }
    } else if (decision.action === 'research') {
      const query = reasoning.researchPlan?.objective || intelligence.entities?.query || clean;
      const input = reasoning.researchPlan ? { query, plan: reasoning.researchPlan } : { query };
      const execution = await this.tools.router.execute('research', input, { capability: 'research' });
      const researchResult = execution.data || { objective: query, sources: [], evidence: [], claims: [], contradictions: [], confidence: 0, completed: false, failed: ['NO_RELIABLE_EVIDENCE'] };
      result = { ok: execution.ok, answer: researchResult.answer || execution.error?.message || 'Araştırma sonucu alınamadı.', route: 'research', action: 'research', tool: 'web_research', toolResult: researchResult, toolExecution: toolSummary(execution), research: researchResult, sources: researchResult.sources || [], claims: researchResult.claims || [], evidence: researchResult.evidence || [], error: execution.error || null };
    } else {
      const remembered = intelligence.memoryRecall ? recallAnswer(clean, relevant, identityBefore) : null;
      if (remembered) result = { ok: true, answer: remembered, route: 'chat', action: 'chat', tool: null, model: this.model };
      else {
        const history = this.memory.getSession(id).messages.slice(-8).map((item) => ({ role: item.role, content: item.content }));
        const system = { role: 'system', content: "Sen Sardis'sin. Türkçe, doğal, kısa ve yardımcı ol. Yalnızca sana verilen konuşma, kimlik ve alakalı kalıcı bilgi bağlamını kullan. Uydurma; güncel bilgi gerekiyorsa aracın sonucunu esas al." };
        try {
          const answer = await this.ollama([system, { role: 'system', content: promptContext(context) }, ...history], options.signal);
          result = { ok: Boolean(answer), answer: answer || fallbackAnswer(clean, context), route: 'chat', action: 'chat', tool: null, model: this.model };
        } catch (error) {
          result = { ok: true, answer: fallbackAnswer(clean, context), route: 'chat', action: 'chat', tool: null, model: this.model, fallback: true, error: String(error.message || error) };
        }
      }
    }

    const verification = verifyResult(result, effectiveIntelligence);
    if (pendingMemory?.operation === 'remember') {
      const fact = this.memory.remember(pendingMemory.value, { source: 'explicit_user' });
      result.fact = fact; result.memory = { operation: 'remember', record: summary(fact) };
    } else if (pendingMemory?.operation === 'forget') {
      const forgotten = this.memory.forget(pendingMemory.value);
      result.memory = { operation: 'forget', forgotten: forgotten.map(summary) };
    }
    if (isCorrection(clean) && !decision.memoryAction) {
      const lesson = this.memory.remember(clean, { type: containsPreference(clean) ? 'preference' : 'lesson', source: 'correction', confidence: 0.95, importance: containsPreference(clean) ? 0.7 : 0.4 });
      result.lesson = summary(lesson);
    }
    const experience = this.experience.record({
      action: result.agent ? `agent:${result.agent.type}` : (result.tool || result.route || intelligence.intent),
      context: { topic: intelligence.topic, intent: intelligence.intent, route: result.route, tool: result.tool || null, researchTopic: result.research?.objective || null, sourceCount: result.research?.sources?.length || 0, contradictions: result.research?.contradictions?.length || 0, ...(result.agent ? { agentStatus: result.agent.status, agentSteps: result.agent.totalSteps, agentType: result.agent.type } : {}) },
      outcome: result.toolResult?.source || result.error?.code || result.error || (result.ok === false ? 'failed' : 'answered'),
      success: result.ok !== false && verification.ok
    });
    const correction = isCorrection(clean) && !decision.memoryAction;
    const learningResult = this.learner.record({ experience, verification, intelligence: effectiveIntelligence, result, correction, userMessage: clean });
    // A city supplied later through a clarification answer is only known on the
    // agent result, so feed it into the context update too.
    const contextIntelligence = result.intelligence?.entities?.city
      ? { ...effectiveIntelligence, entities: { ...(effectiveIntelligence.entities || {}), city: result.intelligence.entities.city } }
      : effectiveIntelligence;
    const nextContext = updateContext(before.context || {}, contextIntelligence, { ...result, learning: { relevantLessons: relevantLessons.map(summarizeLesson) } });
    this.memory.setContext(id, nextContext);
    this.memory.addMessage(id, 'assistant', result.answer);
    const session = this.memory.getSession(id);
    return { ...result, sessionId: id, context: session.context, messages: session.messages, intelligence, reasoning, researchPlan: reasoning.researchPlan || null, verification,
      learning: { applied: relevantLessons.length > 0, lessonsUsed: relevantLessons.length, relevantLessons: relevantLessons.map(summarizeLesson), decision: learningResult.decision, confidence: learningResult.confidence, importance: learningResult.importance, reason: learningResult.reason, event: learningResult.event },
      identity: this.memory.identity(), memory: result.memory || { retrieved: relevant.map(summary) }, experience: summary(experience) };
  }

  // Maps an agent task onto the EXISTING response contract (backward compatible).
  agentResult(outcome, { reasoning, intelligence, effectiveIntelligence }) {
    const task = outcome.task;
    const summary = summarizeTask(task);
    const completed = (task.steps || []).filter((step) => step.status === 'completed');
    const toolSteps = completed.filter((step) => step.type === 'tool');
    const primary = toolSteps[0] || null;
    const research = task.result?.sources ? { objective: task.metadata?.query || task.goal, sources: task.result.sources, claims: task.result.claims, evidence: task.result.evidence, contradictions: task.result.contradictions, completed: task.status === 'completed' } : null;
    const waiting = task.status === 'waiting';
    const isWeather = primary?.tool === 'weather';
    // The city may have arrived later via a clarification answer, so the
    // original message's intelligence has none. Report the RESOLVED city so the
    // session context learns it and a follow-up does not ask again.
    // Only a city that a completed step actually verified is worth remembering.
    const resolvedCity = completed.map((step) => step.input && step.input.city).find(Boolean) || null;
    return {
      ok: task.status === 'completed' || waiting,
      answer: outcome.answer,
      route: waiting ? 'agent' : isWeather ? 'weather' : research ? 'research' : 'agent',
      action: waiting ? 'agent_waiting' : 'agent',
      tool: primary?.tool || null,
      toolResult: completed.length ? completed[completed.length - 1].result?.normalized : null,
      toolExecution: primary ? { name: primary.tool, ok: true, source: primary.result?.source || null, durationMs: primary.durationMs ?? null, fetchedAt: primary.result?.fetchedAt || null, error: null } : null,
      requiresClarification: Boolean(task.requiresClarification),
      requiresApproval: Boolean(task.requiresApproval),
      reasoning: { ...reasoning, agentic: true, taskType: task.type, detection: outcome.detection },
      intelligence: resolvedCity ? { ...intelligence, entities: { ...(intelligence.entities || {}), city: resolvedCity } } : intelligence,
      research,
      sources: task.result?.sources || [],
      claims: task.result?.claims || [],
      evidence: task.result?.evidence || [],
      error: task.error || null,
      agent: {
        taskId: task.id,
        status: task.status,
        currentStep: task.currentStep || 0,
        totalSteps: (task.steps || []).length,
        type: task.type,
        completedSteps: completed.length,
        requiresApproval: Boolean(task.requiresApproval),
        requiresClarification: Boolean(task.requiresClarification),
        verification: outcome.verification || null,
        steps: (task.steps || []).map((step) => ({ id: step.id, order: step.order, type: step.type, tool: step.tool, status: step.status, attempts: step.attempts, verified: step.verification ? Boolean(step.verification.ok) : null, dependsOn: step.dependsOn })),
        taskState: summary
      }
    };
  }

  async *chatStream(sessionId, message, options = {}) {
    const result = await this.chat(sessionId, message, options);
    yield { type: 'status', route: result.route, tool: result.tool, intelligence: result.intelligence };
    yield { type: 'delta', text: result.answer };
    yield { type: 'done', ...result };
  }
  async research(query, sessionId = 'default') { return this.chat(sessionId, `${query} araştır`, {}); }
  async remember(value, sessionId = 'default') { return this.chat(sessionId, `${value} Bunu hatırla.`, {}); }
  async reason(message, sessionId = 'default') { return this.chat(sessionId, message, {}); }
  async execute(tool, args, sessionId = 'default') { return this.chat(sessionId, `${tool} ${JSON.stringify(args)}`, {}); }
  async verify(value) { return { ok: Boolean(value), checkedAt: new Date().toISOString() }; }
  toolMetadata() { return this.tools.registry.list(); }

  // -------------------------------------------------------------------------
  // Agent accessors: thin, safe delegates to the existing AgentRuntime.
  // No new agent logic lives here.
  // -------------------------------------------------------------------------
  async agentTask(message, sessionId = 'default', options = {}) {
    if (!text(message)) return { ok: false, error: 'message_required' };
    // Reuses the full chat pipeline (intent -> reasoning -> detect -> execute ->
    // verification -> experience -> learning) so this can never diverge from /api/chat.
    const result = await this.chat(sessionId, message, options);
    if (!result.agent) return { ok: false, error: 'not_agentic_task', sessionId: result.sessionId, route: result.route, answer: result.answer };
    return this.agentView(result.agent.taskId, {
      ok: result.ok !== false, answer: result.answer, route: result.route,
      sessionId: result.sessionId, verification: result.verification
    });
  }
  async agentResume(taskId, { answer = null, approved = false } = {}) {
    if (!isTaskId(taskId)) return { ok: false, error: 'invalid_task_id' };
    return this.agent.resume(String(taskId), { answer, approved });
  }
  agentCancel(taskId) {
    if (!isTaskId(taskId)) return { ok: false, error: 'invalid_task_id' };
    return this.agent.cancel(String(taskId));
  }
  // Shared read-only projection used by agentTask().
  agentView(taskId, extra = {}) {
    const detail = this.agent.get(taskId);
    if (!detail.ok) return { ok: false, error: detail.error };
    return { ...extra, taskId, status: detail.summary.status, currentStep: detail.summary.currentStep, totalSteps: detail.summary.totalSteps, completedSteps: detail.summary.completedSteps, type: detail.summary.type, requiresApproval: detail.summary.requiresApproval, requiresClarification: detail.summary.requiresClarification, verification: this.agent.verificationFor(detail.task), summary: detail.summary, steps: detail.steps, events: detail.events };
  }
  // Agent runtime health: reports ONLY values read from the live runtime/store.
  agentHealth() {
    if (!this.agent) return { available: false };
    const tasks = this.agent.list({ limit: 200 });
    const byStatus = {};
    for (const task of tasks) byStatus[task.status] = (byStatus[task.status] || 0) + 1;
    return {
      available: true,
      toolLayer: Boolean(this.agent.registry && this.agent.router),
      registeredTools: this.agent.registry ? this.agent.registry.list().length : 0,
      tasks: { total: tasks.length, byStatus },
      limits: this.agent.limits,
      events: { retained: this.agent.events.events.length }
    };
  }
  async health() {
    let ollama = { status: 'offline', model: this.model, url: this.baseUrl };
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(2500) });
      const data = response.ok ? await response.json() : null;
      ollama = { status: response.ok ? 'online' : 'offline', model: this.model, url: this.baseUrl, models: data?.models?.map((item) => item.name) || [] };
    } catch {}
    return { ok: true, service: 'sardis-v6', identity: 'Sardis', userIdentity: this.memory.identity(), ollama,
      memory: { sessions: this.sessions().length, facts: this.memory.facts().length, lessons: this.memory.lessons().length, experiences: this.memory.experiences().length },
      tools: ['chat', 'weather', 'research', 'currency', 'memory'],
      agent: this.agentHealth(),
      toolMetadata: this.toolMetadata() };
  }
}
module.exports = { Sardis };

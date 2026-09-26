'use strict';

const { createLesson, normalizeLesson, safetyCategory } = require('./lesson');
const { calculateConfidence, calculateImportance } = require('./confidence');
const { applyPolicy } = require('./policy');
const { retrieveLessons, findContradiction, summarizeLesson } = require('./retrieval');
const nowIso = () => new Date().toISOString();
const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
const keyFor = (experience) => [experience?.action, experience?.context?.topic, experience?.context?.intent, experience?.context?.route, experience?.context?.tool].filter(Boolean).join('|');
class Learner {
  constructor(memory) { this.memory = memory; this.state = memory.learningState(); }
  refresh() { this.state = this.memory.learningState(); return this.state; }
  retrieve(query, context = {}, options = {}) { return retrieveLessons(this.state.lessons || [], query, context, options); }
  record({ experience, verification = {}, intelligence = {}, result = {}, correction = false, userMessage = '' } = {}) {
    const lessons = this.state.lessons || [];
    const key = keyFor(experience);
    const stats = this.state.experienceStats || {};
    const previous = stats[key] || { uses: 0, successes: 0, failures: 0 };
    const next = { uses: previous.uses + 1, successes: previous.successes + (experience.success ? 1 : 0), failures: previous.failures + (experience.success ? 0 : 1), lastUsedAt: nowIso(), lastSuccessAt: experience.success ? nowIso() : previous.lastSuccessAt || null, lastFailureAt: experience.success ? previous.lastFailureAt || null : nowIso() };
    const safety = safetyCategory(`${result.route || ''} ${result.tool || ''} ${userMessage || ''}`);
    const researchEvidence = Boolean(result.research?.completed && result.research?.sources?.length >= 2);
    const signals = [Boolean(verification.ok), next.successes >= 2, correction, researchEvidence, Boolean(result.toolExecution?.ok), next.failures >= 2];
    const confidence = calculateConfidence({ verification, repetition: next.uses, userCorrection: correction, toolSuccess: Boolean(result.toolExecution?.ok), researchEvidence, consistency: next.successes / Math.max(1, next.uses), failure: !experience.success });
    const importance = calculateImportance({ type: result.research ? 'research' : result.tool ? 'tool-selection' : correction ? 'preference' : 'response', userCorrection: correction, repetition: next.uses, taskImpact: Boolean(result.tool || result.research), personalization: correction });
    const type = result.research ? 'research' : result.tool ? 'tool-selection' : correction ? 'preference' : result.requiresClarification ? 'clarification' : 'response';
    const trigger = `${intelligence.intent || 'chat'}:${result.route || 'response'}`;
    const lessonText = correction ? 'Use explicit user corrections as strong feedback and reconcile prior context safely.' : result.research ? 'Require verified multi-source evidence before presenting research conclusions.' : result.tool ? `Use the ${result.tool || 'selected'} tool path only when its capability matches the request.` : 'Prefer the verified response path when no tool-specific signal exists.';
    const candidate = createLesson({ type, trigger, context: { topic: intelligence.topic, intent: intelligence.intent, route: result.route, tool: result.tool, task: result.action }, lesson: lessonText, source: correction ? 'correction' : 'experience', confidence, importance, status: 'review' });
    const conflict = findContradiction(candidate, lessons);
    const policy = applyPolicy({ confidence, signals, safety, contradiction: Boolean(conflict) });
    candidate.status = policy.status;
    let saved = null;
    const duplicate = lessons.find((lesson) => lesson.type === candidate.type && lesson.trigger === candidate.trigger && clean(lesson.lesson) === clean(candidate.lesson) && lesson.context?.topic === candidate.context?.topic);
    if (duplicate) {
      duplicate.updatedAt = nowIso(); duplicate.confidence = Math.max(duplicate.confidence || 0, confidence); duplicate.importance = Math.max(duplicate.importance || 0, importance); duplicate.uses = (duplicate.uses || 0) + 1; duplicate.status = policy.status; saved = duplicate;
    } else { saved = normalizeLesson(candidate); lessons.unshift(saved); }
    if (conflict && conflict.id !== saved?.id) { conflict.status = 'review'; conflict.updatedAt = nowIso(); }
    const event = { type: 'lesson_candidate', lessonId: saved?.id || null, decision: policy.status, confidence, importance, reason: policy.reason, key, at: nowIso() };
    this.state.lessons = lessons;
    this.state.experienceStats = { ...stats, [key]: next };
    this.state.events = [event, ...(this.state.events || [])].slice(0, 100);
    this.memory.saveLearningState(this.state);
    return { lesson: summarizeLesson(saved), decision: policy.status, confidence, importance, reason: policy.reason, signals, repetition: next, contradiction: conflict ? summarizeLesson(conflict) : null, event };
  }
  events(limit = 20) { return (this.state.events || []).slice(0, limit); }
  learningState() { return this.state; }
}
module.exports = { Learner, keyFor };

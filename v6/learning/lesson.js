'use strict';

const LESSON_TYPES = new Set(['routing', 'tool-selection', 'research', 'clarification', 'memory', 'response', 'verification', 'preference']);
const FORBIDDEN = /security|permission|mcp permission|system prompt|architecture|code execution|external write|financial|account action|write action|shell|filesystem|credential/i;
const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
const makeId = (prefix = 'lesson') => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const safetyCategory = (value) => {
  const text = clean(value);
  if (/security|güvenlik/i.test(text)) return 'security';
  if (/permission|izin|mcp permission/i.test(text)) return 'permissions';
  if (/architecture|mimari|code execution|kod çalıştır|external write|dış yazma|write action/i.test(text)) return 'system_change';
  if (/financial|finansal|account action|hesap işlemi|shell|filesystem|credential/i.test(text)) return 'restricted_action';
  return null;
};
const contextKey = (context = {}) => [context.topic, context.intent, context.route, context.tool].filter(Boolean).map((item) => clean(item).toLowerCase()).join('|');
const lessonKey = (lesson) => [lesson.type, lesson.trigger, contextKey(lesson.context), clean(lesson.lesson).toLowerCase()].join('::');
function createLesson({ type = 'response', trigger = '', context = {}, lesson = '', source = 'experience', confidence = 0.5, importance = 0.4, status = 'review', now = new Date() } = {}) {
  const timestamp = now.toISOString();
  return {
    id: makeId('lesson'), type: LESSON_TYPES.has(type) ? type : 'response', trigger: clean(trigger), context: {
      topic: context.topic || null, intent: context.intent || null, route: context.route || null, tool: context.tool || null, task: context.task || null
    }, lesson: clean(lesson), source, confidence: Math.max(0, Math.min(1, Number(confidence) || 0)), importance: Math.max(0, Math.min(1, Number(importance) || 0)), status, createdAt: timestamp, updatedAt: timestamp, lastValidatedAt: status === 'accepted' ? timestamp : null, expiresAt: null, uses: 0, successes: 0, failures: 0, safetyCategory: safetyCategory(`${type} ${lesson}`) };
}
function normalizeLesson(record = {}, now = new Date()) {
  const created = record.createdAt || now.toISOString();
  return { ...createLesson({ ...record, now: new Date(created) }), ...record, id: clean(record.id) || makeId('lesson'), type: LESSON_TYPES.has(record.type) ? record.type : 'response', trigger: clean(record.trigger), lesson: clean(record.lesson), context: record.context || {}, confidence: Math.max(0, Math.min(1, Number(record.confidence) || 0)), importance: Math.max(0, Math.min(1, Number(record.importance) || 0)), status: ['accepted', 'review', 'rejected'].includes(record.status) ? record.status : 'review', createdAt: created, updatedAt: record.updatedAt || created, lastValidatedAt: record.lastValidatedAt || null, expiresAt: record.expiresAt || null, uses: Number(record.uses) || 0, successes: Number(record.successes) || 0, failures: Number(record.failures) || 0, safetyCategory: record.safetyCategory || safetyCategory(`${record.type || ''} ${record.lesson || ''}`) };
}
function isActive(lesson, now = new Date()) { return lesson?.status === 'accepted' && (!lesson.expiresAt || Date.parse(lesson.expiresAt) > now.getTime()); }
function isSameBehavior(left, right) { return lessonKey(left) === lessonKey(right); }
module.exports = { LESSON_TYPES, FORBIDDEN, safetyCategory, contextKey, lessonKey, createLesson, normalizeLesson, isActive, isSameBehavior, makeId };

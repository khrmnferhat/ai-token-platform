'use strict';

const { tokens } = require('../memory/retrieval');
const { isActive, contextKey, isSameBehavior } = require('./lesson');
const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
function relevantScore(lesson, query, context = {}) {
  if (!isActive(lesson)) return 0;
  const lessonContext = lesson.context || {};
  if (context.topic && lessonContext.topic && context.topic !== lessonContext.topic) return 0;
  if (context.intent && lessonContext.intent && context.intent !== lessonContext.intent && lessonContext.intent !== 'chat') return 0;
  if (context.tool && lessonContext.tool && context.tool !== lessonContext.tool) return 0;
  const text = `${lesson.type} ${lesson.trigger} ${lesson.lesson} ${Object.values(lesson.context || {}).join(' ')}`.toLocaleLowerCase('tr-TR');
  const queryTokens = new Set(tokens(`${query} ${context.intent || ''} ${context.topic || ''} ${context.task || ''} ${context.tool || ''}`));
  const lessonTokens = new Set(tokens(text));
  const overlap = [...queryTokens].filter((token) => lessonTokens.has(token)).length;
  const contextMatch = contextKey(lesson.context) === contextKey(context) ? 1 : 0;
  const ageDays = Math.max(0, (Date.now() - Date.parse(lesson.lastValidatedAt || lesson.updatedAt || lesson.createdAt || '') || Date.now()) / 86400000);
  const recency = Math.max(0, 0.3 - ageDays / 7300);
  return Number((overlap * 0.22 + contextMatch * 0.5 + Number(lesson.importance || 0) * 0.2 + Number(lesson.confidence || 0) * 0.3 + recency).toFixed(4));
}
function retrieveLessons(lessons, query, context = {}, { limit = 4 } = {}) {
  return (lessons || []).map((lesson) => ({ ...lesson, relevanceScore: relevantScore(lesson, query, context) })).filter((lesson) => lesson.relevanceScore >= 0.45).sort((left, right) => right.relevanceScore - left.relevanceScore || String(right.updatedAt).localeCompare(String(left.updatedAt))).slice(0, limit);
}
function findContradiction(candidate, lessons) {
  return (lessons || []).find((lesson) => lesson.type === candidate.type && lesson.context?.topic === candidate.context?.topic && lesson.context?.intent === candidate.context?.intent && !isSameBehavior(lesson, candidate) && isActive(lesson));
}
function summarizeLesson(lesson) { return lesson ? { id: lesson.id, type: lesson.type, lesson: lesson.lesson, confidence: lesson.confidence, importance: lesson.importance, status: lesson.status, uses: lesson.uses || 0 } : null; }
module.exports = { relevantScore, retrieveLessons, findContradiction, summarizeLesson, clean };

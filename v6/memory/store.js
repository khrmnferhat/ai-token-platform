'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { rebuildIdentity, identitySnapshot, containsPreference } = require('./identity');
const { normalized, detectSubject, isCurrent, retrieve, tokens } = require('./retrieval');
const SOURCE_CONFIDENCE = { explicit_user: 0.95, correction: 0.95, conversation: 0.65, experience: 0.70 };
const TYPE_IMPORTANCE = { fact: 0.6, preference: 0.7, lesson: 0.4, experience: 0.3 };
const USER_MEMORY_TYPES = ['fact', 'preference', 'lesson'];
const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
const makeId = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const decorate = (record) => record ? { ...record, text: record.content } : null;
function normalizeRecord(record) {
  const now = new Date().toISOString();
  const content = clean(record.content || record.text);
  const source = record.source || 'conversation';
  const type = record.type || 'fact';
  return {
    id: clean(record.id) || makeId(type), type, content,
    confidence: Number.isFinite(Number(record.confidence)) ? Number(record.confidence) : (SOURCE_CONFIDENCE[source] || 0.65),
    source, createdAt: record.createdAt || now, updatedAt: record.updatedAt || record.createdAt || now,
    validFrom: record.validFrom || record.createdAt || now, validUntil: record.validUntil || null,
    importance: Number.isFinite(Number(record.importance)) ? Number(record.importance) : (TYPE_IMPORTANCE[type] || 0.5),
    ...(type === 'experience' ? { action: clean(record.action), context: record.context || {}, outcome: clean(record.outcome), success: Boolean(record.success), uses: Number(record.uses) || 1, successes: Number(record.successes) || (record.success ? 1 : 0), failures: Number(record.failures) || (record.success ? 0 : 1), lastUsedAt: record.lastUsedAt || now, lastSuccessAt: record.lastSuccessAt || (record.success ? now : null), lastFailureAt: record.lastFailureAt || (record.success ? null : now) } : {})
  };
}
class MemoryStore {
  constructor(filePath) {
    this.filePath = filePath;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    this.state = this.load();
  }
  load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      const sessions = parsed.sessions && typeof parsed.sessions === 'object' ? parsed.sessions : {};
      const source = Array.isArray(parsed.memories) ? parsed.memories : (Array.isArray(parsed.facts) ? parsed.facts : []);
      const memories = source.map(normalizeRecord).filter((record) => record.content);
      const learning = parsed.learning && typeof parsed.learning === 'object' ? { lessons: Array.isArray(parsed.learning.lessons) ? parsed.learning.lessons : [], experienceStats: parsed.learning.experienceStats && typeof parsed.learning.experienceStats === 'object' ? parsed.learning.experienceStats : {}, events: Array.isArray(parsed.learning.events) ? parsed.learning.events : [] } : { lessons: [], experienceStats: {}, events: [] };
      return { version: 3, sessions, memories, identity: rebuildIdentity(memories), learning };
    } catch {
      return { version: 3, sessions: {}, memories: [], identity: rebuildIdentity([]), learning: { lessons: [], experienceStats: {}, events: [] } };
    }
  }
  save() {
    this.state.version = 3;
    this.state.learning = this.state.learning || { lessons: [], experienceStats: {}, events: [] };
    this.state.identity = rebuildIdentity(this.state.memories);
    fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2), 'utf8');
  }
  normalizeId(value) { return String(value || 'default').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80) || 'default'; }
  ensureSession(value) {
    const sessionId = this.normalizeId(value);
    if (!this.state.sessions[sessionId]) this.state.sessions[sessionId] = { id: sessionId, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), messages: [], context: {} };
    return this.state.sessions[sessionId];
  }
  getSession(value) { return this.ensureSession(value); }
  listSessions() {
    return Object.values(this.state.sessions).map((session) => ({ id: session.id, createdAt: session.createdAt, updatedAt: session.updatedAt, messageCount: session.messages.length, preview: [...session.messages].reverse().find((item) => item.role === 'user')?.content || 'Yeni sohbet' })).sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
  }
  addMessage(value, role, content) {
    const session = this.ensureSession(value);
    session.messages.push({ role, content: clean(content), createdAt: new Date().toISOString() });
    session.messages = session.messages.slice(-40);
    session.updatedAt = new Date().toISOString();
    this.save();
    return session;
  }
  setContext(value, patch) {
    const session = this.ensureSession(value);
    session.context = { ...session.context, ...patch };
    session.updatedAt = new Date().toISOString();
    this.save();
    return session.context;
  }
  addMemory(content, options = {}) {
    const value = clean(content);
    if (!value) return null;
    const now = new Date().toISOString();
    const type = options.type || (containsPreference(value) ? 'preference' : 'fact');
    const source = options.source || 'explicit_user';
    const subject = detectSubject(value);
    const duplicate = this.state.memories.find((record) => isCurrent(record) && (normalized(record.content) === normalized(value) || (subject && detectSubject(record.content)?.key === subject.key && detectSubject(record.content)?.value === subject.value)));
    if (duplicate) {
      duplicate.updatedAt = now;
      duplicate.confidence = Math.min(1, Number(duplicate.confidence || 0) + 0.02);
      duplicate.validUntil = duplicate.validUntil && Date.parse(duplicate.validUntil) <= Date.parse(now) ? null : duplicate.validUntil;
      this.save();
      return decorate(duplicate);
    }
    if (type === 'preference' && source === 'correction') {
      const correctionTokens = new Set(tokens(value));
      for (const record of this.state.memories) if (isCurrent(record) && record.type === 'preference') {
        const overlap = tokens(record.content).filter((token) => correctionTokens.has(token)).length;
        if (overlap >= 2) { record.validUntil = now; record.confidence = Math.min(Number(record.confidence || 0), 0.35); record.updatedAt = now; }
      }
    }
    if (subject) for (const record of this.state.memories) {
      if (isCurrent(record) && USER_MEMORY_TYPES.includes(record.type) && detectSubject(record.content)?.key === subject.key) {
        record.validUntil = now;
        record.updatedAt = now;
      }
    }
    const record = normalizeRecord({ ...options, id: makeId(type), type, source, content: value, createdAt: now, updatedAt: now, validFrom: now, confidence: options.confidence ?? SOURCE_CONFIDENCE[source] ?? 0.65 });
    this.state.memories.unshift(record);
    this.save();
    return decorate(record);
  }
  remember(content, options = {}) { return this.addMemory(content, options); }
  forget(content) {
    const value = clean(content);
    if (!value) return [];
    const now = new Date().toISOString();
    const subject = detectSubject(value);
    const forgotten = this.state.memories.filter((record) => isCurrent(record) && USER_MEMORY_TYPES.includes(record.type) && (normalized(record.content) === normalized(value) || (subject && detectSubject(record.content)?.key === subject.key)));
    for (const record of forgotten) { record.validUntil = now; record.updatedAt = now; }
    if (forgotten.length) this.save();
    return forgotten.map(decorate);
  }
  recordExperience({ action, context = {}, outcome = '', success = false } = {}) {
    const now = new Date().toISOString();
    const record = normalizeRecord({ type: 'experience', source: 'experience', content: clean(`${action || 'chat'} -> ${outcome || (success ? 'successful' : 'failed')}`), action, context, outcome, success, uses: 1, successes: success ? 1 : 0, failures: success ? 0 : 1, lastUsedAt: now, lastSuccessAt: success ? now : null, lastFailureAt: success ? null : now, importance: TYPE_IMPORTANCE.experience });
    this.state.memories.unshift(record);
    this.save();
    return decorate(record);
  }
  learningState() { return this.state.learning || { lessons: [], experienceStats: {}, events: [] }; }
  saveLearningState(learning) { this.state.learning = learning || { lessons: [], experienceStats: {}, events: [] }; this.save(); return this.state.learning; }
  retrieve(query, { limit = 5, types = USER_MEMORY_TYPES } = {}) { return retrieve(this.state.memories.filter((record) => types.includes(record.type)), query, { limit }); }
  memories({ currentOnly = false, types = USER_MEMORY_TYPES } = {}) { return this.state.memories.filter((record) => types.includes(record.type) && (!currentOnly || isCurrent(record))).map(decorate); }
  facts() { return this.memories({ currentOnly: true, types: ['fact', 'preference'] }); }
  lessons() { return this.memories({ currentOnly: true, types: ['lesson'] }); }
  experiences() { return this.memories({ currentOnly: true, types: ['experience'] }); }
  identity() { return identitySnapshot(this.state.identity); }
  removeSession(value) { delete this.state.sessions[this.normalizeId(value)]; this.save(); }
}
module.exports = { MemoryStore, SOURCE_CONFIDENCE };

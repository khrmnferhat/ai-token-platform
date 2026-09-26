'use strict';

const { LIMITS } = require('./limits');

// Redacted observability (spec §32). Raw user content is NEVER stored; only
// lengths, hashes and structural metadata survive.
const nowIso = () => new Date().toISOString();
const EVENTS = ['task_created', 'task_planned', 'plan_rejected', 'step_started', 'step_completed', 'step_failed', 'step_retried', 'step_skipped', 'task_waiting', 'task_resumed', 'task_completed', 'task_failed', 'task_cancelled'];

function digest(value) {
  const text = String(value || '');
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  return `h${hash.toString(36)}`;
}

class AgentEventLog {
  constructor({ maxEventsPerTask = LIMITS.maxEventsPerTask, maxGlobalEvents = LIMITS.maxGlobalEvents } = {}) {
    this.maxEventsPerTask = maxEventsPerTask;
    this.maxGlobalEvents = maxGlobalEvents;
    this.events = [];
  }

  emit(type, taskId, payload = {}) {
    if (!EVENTS.includes(type)) return null;
    // Canonical fields are applied AFTER the payload so a payload key named
    // "type"/"taskId"/"at" can never overwrite the event identity.
    const event = { ...this.sanitize(payload), type, taskId: taskId || null, at: nowIso() };
    this.events.unshift(event);
    this.events = this.events.slice(0, this.maxGlobalEvents);
    return event;
  }

  sanitize(payload = {}) {
    const safe = {};
    for (const [key, value] of Object.entries(payload || {})) {
      if (/goal|message|text|content|answer|raw|evidence|query|description/i.test(key)) {
        if (value === undefined || value === null) continue;
        safe[`${key}Length`] = String(value).length;
        safe[`${key}Digest`] = digest(value);
        continue;
      }
      if (typeof value === 'function') continue;
      safe[key] = value;
    }
    return safe;
  }

  forTask(taskId, limit = 50) { return this.events.filter((event) => event.taskId === taskId).slice(0, limit); }
  recent(limit = 50) { return this.events.slice(0, limit); }
}

module.exports = { AgentEventLog, digest, EVENTS };

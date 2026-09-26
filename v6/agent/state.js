'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { LIMITS } = require('./limits');

// Task state is PERSISTENT but strictly SEPARATE from Memory / Experience /
// Learning (spec §12, §25). It lives in its own file and its own record types.
class TaskStateStore {
  constructor(filePath, { maxRetainedTasks = LIMITS.maxRetainedTasks } = {}) {
    this.filePath = filePath;
    this.maxRetainedTasks = maxRetainedTasks;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    this.tasks = this.load();
  }

  load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      return parsed && typeof parsed === 'object' && parsed.tasks && typeof parsed.tasks === 'object' ? parsed.tasks : {};
    } catch {
      return {};
    }
  }

  save() {
    const ordered = Object.values(this.tasks).sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')));
    const tasks = {};
    for (const task of ordered.slice(0, this.maxRetainedTasks)) tasks[task.id] = task;
    const body = JSON.stringify({ version: 1, tasks }, null, 2);
    const temporary = `${this.filePath}.tmp`;
    fs.writeFileSync(temporary, body, 'utf8');
    fs.renameSync(temporary, this.filePath);
    this.tasks = tasks;
    return tasks;
  }

  put(task) {
    if (!task?.id) return null;
    this.tasks[task.id] = { ...task, updatedAt: task.updatedAt || new Date().toISOString() };
    this.save();
    return this.tasks[task.id];
  }

  get(taskId) { return this.tasks[String(taskId || '')] || null; }

  list({ sessionId = null, status = null, limit = 20 } = {}) {
    return Object.values(this.tasks)
      .filter((task) => (sessionId ? task.sessionId === sessionId : true))
      .filter((task) => (status ? task.status === status : true))
      .sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')))
      .slice(0, Math.max(1, limit));
  }

  // Resume support: a waiting task is reloaded and its blocked step re-queued.
  findResumable(sessionId) {
    return Object.values(this.tasks)
      .filter((task) => task.status === 'waiting' && (!sessionId || task.sessionId === sessionId))
      .sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')))[0] || null;
  }

  remove(taskId) {
    const key = String(taskId || '');
    if (!this.tasks[key]) return false;
    delete this.tasks[key];
    this.save();
    return true;
  }
}

module.exports = { TaskStateStore };

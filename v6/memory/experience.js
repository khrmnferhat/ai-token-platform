'use strict';

class ExperienceJournal {
  constructor(memory) { this.memory = memory; }

  record({ action, context = {}, outcome = '', success = false } = {}) {
    return this.memory.recordExperience({ action, context, outcome, success });
  }

  retrieve(query, limit = 3) {
    return this.memory.retrieve(query, { limit, types: ['experience'] });
  }
}

module.exports = { ExperienceJournal };

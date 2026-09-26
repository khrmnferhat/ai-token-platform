'use strict';

const { detectSubject, isCurrent, normalized } = require('./retrieval');

function factReference(record) {
  return {
    id: record.id,
    content: record.content,
    confidence: record.confidence,
    source: record.source,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    importance: record.importance
  };
}

function rebuildIdentity(records, previous = {}) {
  const explicit = records
    .filter((record) => isCurrent(record))
    .filter((record) => ['explicit_user', 'correction'].includes(record.source))
    .filter((record) => Number(record.confidence || 0) >= 0.9)
    .filter((record) => ['fact', 'preference'].includes(record.type))
    .sort((left, right) => String(left.validFrom || left.createdAt).localeCompare(String(right.validFrom || right.createdAt)));

  const identity = {
    name: null,
    explicitFacts: [],
    preferences: [],
    profile: {},
    updatedAt: previous.updatedAt || null
  };

  for (const record of explicit) {
    if (record.type === 'preference') identity.preferences.push(factReference(record));
    else identity.explicitFacts.push(factReference(record));
    const subject = detectSubject(record.content);
    if (subject?.key === 'name') identity.name = subject.value;
    if (subject?.key === 'operating_system') identity.profile.operatingSystem = subject.value;
    if (subject?.key === 'location') identity.profile.location = subject.value;
    identity.updatedAt = record.updatedAt || record.createdAt || identity.updatedAt;
  }
  return identity;
}

function containsPreference(content) {
  return /tercih\s+(?:ederim|ediyorum)|tercihim|seviyorum|beğeniyorum|uygun\s+geliyor|prefer|like|love/iu.test(String(content || ''));
}

function identitySnapshot(identity) {
  return {
    name: identity?.name || null,
    explicitFacts: identity?.explicitFacts || [],
    preferences: identity?.preferences || [],
    profile: { ...(identity?.profile || {}) },
    updatedAt: identity?.updatedAt || null
  };
}

module.exports = { rebuildIdentity, identitySnapshot, containsPreference, factReference, normalized };

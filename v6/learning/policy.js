'use strict';

const { safetyCategory } = require('./lesson');
function applyPolicy({ confidence = 0, signals = [], safety = null, contradiction = false } = {}) {
  const strongSignalCount = signals.filter(Boolean).length;
  if (safety) return { status: 'rejected', reason: `safety_boundary:${safety}` };
  if (contradiction) return { status: 'review', reason: 'contradictory_lesson' };
  if (confidence >= 0.82 && strongSignalCount >= 2) return { status: 'accepted', reason: 'high_confidence_repeated_signal' };
  if (confidence >= 0.6 && strongSignalCount >= 3) return { status: 'accepted', reason: 'repeated_verified_signal' };
  if (confidence >= 0.7 && strongSignalCount >= 2 && signals[2]) return { status: 'accepted', reason: 'explicit_user_correction' };
  if (confidence >= 0.6 && strongSignalCount >= 1) return { status: 'review', reason: 'interesting_but_insufficient_evidence' };
  return { status: 'rejected', reason: 'weak_signal' };
}
function lessonFromSafety(value) { return safetyCategory(value); }
module.exports = { applyPolicy, lessonFromSafety };

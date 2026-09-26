'use strict';

// The few natural time references that imply a SEPARATE lookup. Shared by
// detection and planning so they can never disagree about a request.
const TIME_REFERENCE = {
  today: /bug[üu]n/iu,
  tomorrow: /yar[ıi]n|tomorrow/iu,
  weekend: /hafta\s+sonu|weekend/iu
};

const PERIOD_LABEL = { today: 'bugün', tomorrow: 'yarın', weekend: 'hafta sonu' };

function requestedPeriods(goal, fallback = 'today') {
  const value = String(goal || '').toLocaleLowerCase('tr-TR');
  const found = Object.keys(TIME_REFERENCE).filter((period) => TIME_REFERENCE[period].test(value));
  return found.length ? found : [fallback];
}

// How many distinct periods the request names (0 when none).
function countTimeReferences(goal) { return requestedPeriods(goal, '').length; }

module.exports = { TIME_REFERENCE, PERIOD_LABEL, requestedPeriods, countTimeReferences };

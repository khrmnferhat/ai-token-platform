'use strict';

// Deterministic execution policy. Safety decisions are NEVER delegated to the LLM (spec §18).
// allow -> run, ask -> approval/clarification gate, deny -> stop.
const DECISION = Object.freeze({ ALLOW: 'allow', ASK: 'ask', DENY: 'deny' });

const ACTION_CLASS = Object.freeze({
  READ: 'read',
  SEARCH: 'search',
  RESEARCH: 'research',
  MEMORY: 'memory',
  EXTERNAL_WRITE: 'external_write',
  FINANCIAL: 'financial',
  ACCOUNT_MODIFY: 'account_modify',
  IRREVERSIBLE: 'irreversible',
  DANGEROUS: 'dangerous'
});

const ALLOWED_CLASSES = new Set([ACTION_CLASS.READ, ACTION_CLASS.SEARCH, ACTION_CLASS.RESEARCH, ACTION_CLASS.MEMORY]);
const ASK_CLASSES = new Set([ACTION_CLASS.EXTERNAL_WRITE, ACTION_CLASS.FINANCIAL, ACTION_CLASS.ACCOUNT_MODIFY, ACTION_CLASS.IRREVERSIBLE]);

// Capability names map to deterministic action classes.
const CAPABILITY_CLASS = Object.freeze({
  read: ACTION_CLASS.READ,
  search: ACTION_CLASS.SEARCH,
  weather: ACTION_CLASS.READ,
  currency: ACTION_CLASS.READ,
  research: ACTION_CLASS.RESEARCH,
  memory: ACTION_CLASS.MEMORY,
  external: ACTION_CLASS.READ,
  write: ACTION_CLASS.EXTERNAL_WRITE,
  external_write: ACTION_CLASS.EXTERNAL_WRITE,
  financial: ACTION_CLASS.FINANCIAL,
  payment: ACTION_CLASS.FINANCIAL,
  transfer: ACTION_CLASS.FINANCIAL,
  purchase: ACTION_CLASS.FINANCIAL,
  account: ACTION_CLASS.ACCOUNT_MODIFY,
  account_modify: ACTION_CLASS.ACCOUNT_MODIFY,
  irreversible: ACTION_CLASS.IRREVERSIBLE,
  delete: ACTION_CLASS.IRREVERSIBLE,
  dangerous: ACTION_CLASS.DANGEROUS
});

const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();

// Effective class of a tool: strongest (most dangerous) of its declared capabilities.
function classifyTool(tool) {
  const capabilities = Array.isArray(tool?.capabilities) ? tool.capabilities.map((item) => String(item).toLowerCase()) : [];
  const classes = capabilities.map((capability) => CAPABILITY_CLASS[capability]).filter(Boolean);
  if (classes.includes(ACTION_CLASS.DANGEROUS)) return ACTION_CLASS.DANGEROUS;
  if (classes.includes(ACTION_CLASS.IRREVERSIBLE)) return ACTION_CLASS.IRREVERSIBLE;
  if (classes.includes(ACTION_CLASS.FINANCIAL)) return ACTION_CLASS.FINANCIAL;
  if (classes.includes(ACTION_CLASS.ACCOUNT_MODIFY)) return ACTION_CLASS.ACCOUNT_MODIFY;
  if (classes.includes(ACTION_CLASS.EXTERNAL_WRITE)) return ACTION_CLASS.EXTERNAL_WRITE;
  if (classes.includes(ACTION_CLASS.RESEARCH)) return ACTION_CLASS.RESEARCH;
  if (classes.includes(ACTION_CLASS.SEARCH)) return ACTION_CLASS.SEARCH;
  if (classes.includes(ACTION_CLASS.MEMORY)) return ACTION_CLASS.MEMORY;
  if (classes.includes(ACTION_CLASS.READ)) return ACTION_CLASS.READ;
  return ACTION_CLASS.READ;
}

function decide({ tool = null, stepType = 'tool', capabilities = null, approved = false } = {}) {
  // Internal reasoning steps never touch external state.
  if (stepType === 'reason') return { decision: DECISION.ALLOW, actionClass: ACTION_CLASS.READ, reason: 'internal_step', requiresApproval: false, approvalReason: null };
  const declared = Array.isArray(capabilities) && capabilities.length ? capabilities.map((item) => String(item).toLowerCase()) : null;
  const classes = (declared || (Array.isArray(tool?.capabilities) ? tool.capabilities : [])).map((capability) => CAPABILITY_CLASS[String(capability).toLowerCase()]).filter(Boolean);
  const actionClass = classes.includes(ACTION_CLASS.DANGEROUS) ? ACTION_CLASS.DANGEROUS
    : classes.includes(ACTION_CLASS.IRREVERSIBLE) ? ACTION_CLASS.IRREVERSIBLE
      : classes.includes(ACTION_CLASS.FINANCIAL) ? ACTION_CLASS.FINANCIAL
        : classes.includes(ACTION_CLASS.ACCOUNT_MODIFY) ? ACTION_CLASS.ACCOUNT_MODIFY
          : classes.includes(ACTION_CLASS.EXTERNAL_WRITE) ? ACTION_CLASS.EXTERNAL_WRITE
            : classes.length ? classes[0] : classifyTool(tool);
  if (actionClass === ACTION_CLASS.DANGEROUS) {
    return { decision: DECISION.DENY, actionClass, reason: 'dangerous_action', requiresApproval: false, approvalReason: null };
  }
  if (ALLOWED_CLASSES.has(actionClass)) {
    return { decision: DECISION.ALLOW, actionClass, reason: 'read_only', requiresApproval: false, approvalReason: null };
  }
  if (ASK_CLASSES.has(actionClass)) {
    if (approved) return { decision: DECISION.ALLOW, actionClass, reason: 'approved_by_user', requiresApproval: false, approvalReason: null };
    return { decision: DECISION.ASK, actionClass, reason: actionClass, requiresApproval: true, approvalReason: actionClass };
  }
  return { decision: DECISION.ASK, actionClass, reason: 'unknown_action_class', requiresApproval: true, approvalReason: actionClass };
}

// Missing required information is an "ask" (clarification) decision, not an LLM guess.
const FIELD_QUESTION = {
  city: 'Tabii. Hangi şehir için hava durumuna bakmamı istersin?',
  base: 'Hangi para biriminin kurunu alayım?',
  quote: 'Hangi para birimine çevireyim?',
  query: 'Neyi araştırmamı istersin?'
};
function decideClarification({ missing = [], question = null } = {}) {
  const fields = (missing || []).filter(Boolean);
  if (!fields.length) return { decision: DECISION.ALLOW, reason: 'complete', missing: [] };
  const asked = clean(question) || FIELD_QUESTION[fields[0]] || `Devam edebilmem için ${fields.join(' ve ')} bilgisine ihtiyacım var.`;
  return { decision: DECISION.ASK, reason: 'missing_required_information', missing: fields, question: asked, requiresApproval: false };
}

module.exports = { DECISION, ACTION_CLASS, CAPABILITY_CLASS, ALLOWED_CLASSES, ASK_CLASSES, classifyTool, decide, decideClarification, clean };

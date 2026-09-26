'use strict';

const DEFAULT_ALLOWED = ['read', 'search', 'weather', 'currency', 'research', 'memory', 'external'];
function canUse(tool, requestedCapability, allowedCapabilities = DEFAULT_ALLOWED) {
  const capabilities = tool?.capabilities || [];
  const allowed = new Set(allowedCapabilities || []);
  if (requestedCapability && !capabilities.includes(requestedCapability)) return false;
  return capabilities.some((capability) => allowed.has(capability));
}
module.exports = { canUse, DEFAULT_ALLOWED };

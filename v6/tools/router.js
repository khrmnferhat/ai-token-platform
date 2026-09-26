'use strict';

const { canUse } = require('./permissions');
const { validateInput } = require('./validation');

const toolName = (tool) => typeof tool === 'string' ? tool : tool?.name || 'unknown';
const failure = (tool, code, message, metadata = {}, data = null) => ({ ok: false, tool: toolName(tool), data, error: { code, message }, metadata: { fetchedAt: new Date().toISOString(), ...metadata } });
const success = (tool, data, metadata = {}) => ({ ok: true, tool: toolName(tool), data, error: null, metadata: { fetchedAt: new Date().toISOString(), ...metadata } });
function normalizeAdapterResult(tool, result, durationMs) {
  if (result && result.ok === true) return success(tool, result.data ?? result, { source: result.source || result.metadata?.source || 'unknown', durationMs });
  if (result && result.ok === false) {
    const error = result.error && typeof result.error === 'object' ? result.error : { code: result.error || 'TOOL_FAILURE', message: result.detail || 'Araç işlemi tamamlanamadı.' };
    return failure(tool, String(error.code || 'TOOL_FAILURE').toUpperCase(), result.detail || error.message || 'Araç işlemi tamamlanamadı.', { durationMs, source: result.source || result.metadata?.source || 'unknown' }, result.data ?? null);
  }
  return failure(tool, 'MALFORMED_TOOL_RESULT', 'Araç geçersiz sonuç döndürdü.', { durationMs });
}
async function withTimeout(task, timeoutMs) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return task();
  let timer;
  try { return await Promise.race([Promise.resolve().then(task), new Promise((_, reject) => { timer = setTimeout(() => { const error = new Error('Tool timed out'); error.code = 'TIMEOUT'; reject(error); }, timeoutMs); })]); } finally { clearTimeout(timer); }
}
class ToolRouter {
  constructor(registry, { defaultTimeoutMs = 15000, allowedCapabilities } = {}) { this.registry = registry; this.defaultTimeoutMs = defaultTimeoutMs; this.allowedCapabilities = allowedCapabilities; }
  resolve(nameOrCapability) { const value = String(nameOrCapability || '').trim(); return this.registry.get(value) || this.registry.findByCapability(value).map((metadata) => this.registry.get(metadata.name)).find(Boolean) || null; }
  async execute(nameOrCapability, input = {}, { capability, timeoutMs = this.defaultTimeoutMs, allowedCapabilities = this.allowedCapabilities } = {}) {
    const started = Date.now();
    const tool = this.resolve(nameOrCapability);
    if (!tool) return failure(String(nameOrCapability || 'unknown'), 'TOOL_NOT_FOUND', 'İstenen araç bulunamadı.');
    if (tool.enabled === false) return failure(tool.name, 'TOOL_DISABLED', 'Bu araç şu anda kullanılamıyor.', { durationMs: Date.now() - started });
    if (!canUse(tool, capability, allowedCapabilities)) return failure(tool.name, 'TOOL_PERMISSION_DENIED', 'Bu araç için izin yok.', { durationMs: Date.now() - started });
    const validation = validateInput(input, tool.inputSchema);
    if (!validation.ok) return failure(tool.name, 'INVALID_TOOL_INPUT', 'Araç girdileri geçersiz.', { durationMs: Date.now() - started, details: validation.errors });
    try { return normalizeAdapterResult(tool, await withTimeout(() => tool.execute(input, { signal: AbortSignal.timeout(timeoutMs) }), timeoutMs), Date.now() - started); } catch (error) { const code = error?.code === 'TIMEOUT' ? 'TIMEOUT' : 'TOOL_FAILURE'; return failure(tool.name, code, code === 'TIMEOUT' ? 'Araç zaman aşımına uğradı.' : 'Araç işlemi sırasında hata oluştu.', { durationMs: Date.now() - started }); }
  }
}
module.exports = { ToolRouter, normalizeAdapterResult, withTimeout };

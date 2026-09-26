'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { Sardis } = require('./core/sardis');

const PORT = Number(process.env.V6_PORT || 3060);
const CLIENT = path.join(__dirname, 'client');
const sardis = new Sardis();
function json(res, status, payload) { const body = JSON.stringify(payload); res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body), 'access-control-allow-origin': '*' }); res.end(body); }
function readBody(req) { return new Promise((resolve, reject) => { let body = ''; req.on('data', (chunk) => { body += chunk; if (body.length > 100000) reject(new Error('payload_too_large')); }); req.on('end', () => { try { resolve(body ? JSON.parse(body) : {}); } catch { reject(new Error('invalid_json')); } }); req.on('error', reject); }); }
function safePath(urlPath) { const relative = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, ''); const target = path.resolve(CLIENT, relative); return target.startsWith(CLIENT) ? target : null; }
async function route(req, res, url) {
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS', 'access-control-allow-headers': 'content-type' }); return res.end(); }
  if (req.method === 'GET' && url.pathname === '/api/health') return json(res, 200, await sardis.health());
  if (req.method === 'GET' && url.pathname === '/api/tools') return json(res, 200, { tools: sardis.toolMetadata() });
  if (req.method === 'GET' && url.pathname === '/api/sessions') return json(res, 200, { sessions: sardis.sessions() });
  if (req.method === 'POST' && url.pathname === '/api/session') { const body = await readBody(req); return json(res, 200, { sessionId: sardis.newConversation(body.sessionId) }); }
  const match = url.pathname.match(/^\/api\/session\/([^/]+)$/);
  if (req.method === 'GET' && match) return json(res, 200, sardis.session(match[1]));
  if (req.method === 'DELETE' && match) { sardis.memory.removeSession(match[1]); return json(res, 200, { ok: true }); }
  if (req.method === 'POST' && url.pathname === '/api/chat') {
    const body = await readBody(req); if (!body.message) return json(res, 400, { ok: false, error: 'message_required' });
    res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-cache', 'connection': 'keep-alive', 'access-control-allow-origin': '*' });
    try { const result = await sardis.chat(body.sessionId, body.message); res.write(`${JSON.stringify({ type: 'status', route: result.route, tool: result.tool })}\n`); for (const part of String(result.answer).match(/.{1,24}(?:\s|$)|.{1,24}$/g) || [result.answer]) res.write(`${JSON.stringify({ type: 'delta', text: part })}\n`); res.write(`${JSON.stringify({ type: 'done', ...result })}\n`); } catch (error) { res.write(`${JSON.stringify({ type: 'error', error: String(error.message || error) })}\n`); }
    return res.end();
  }
  // --- agent task API (internal; /api/chat above is untouched) --------------
  if (req.method === 'POST' && url.pathname === '/api/agent') {
    const body = await readBody(req);
    if (!body.message) return json(res, 400, { ok: false, error: 'message_required' });
    const outcome = await sardis.agentTask(body.message, body.sessionId);
    return json(res, 200, outcome);
  }
  const taskMatch = url.pathname.match(/^\/api\/agent\/([^/]+)$/);
  const taskResume = url.pathname.match(/^\/api\/agent\/([^/]+)\/resume$/);
  const taskCancel = url.pathname.match(/^\/api\/agent\/([^/]+)\/cancel$/);
  if (req.method === 'GET' && taskMatch) {
    const taskId = decodeURIComponent(taskMatch[1]);
    if (!sardis.isValidTaskId(taskId)) return json(res, 400, { ok: false, error: 'invalid_task_id' });
    const found = sardis.agent.get(taskId);
    if (!found.ok) return json(res, 404, { ok: false, error: found.error });
    return json(res, 200, found);
  }
  if (req.method === 'POST' && taskResume) {
    const taskId = decodeURIComponent(taskResume[1]);
    if (!sardis.isValidTaskId(taskId)) return json(res, 400, { ok: false, error: 'invalid_task_id' });
    const body = await readBody(req);
    const resumed = await sardis.agentResume(taskId, { answer: body.answer ?? null, approved: body.approved === true });
    if (resumed.error === 'TASK_NOT_FOUND') return json(res, 404, { ok: false, error: resumed.error });
    if (resumed.error === 'invalid_task_id') return json(res, 400, { ok: false, error: resumed.error });
    if (resumed.error) return json(res, 409, { ok: false, error: resumed.error, summary: resumed.summary || null });
    return json(res, 200, resumed);
  }
  if (req.method === 'POST' && taskCancel) {
    const taskId = decodeURIComponent(taskCancel[1]);
    if (!sardis.isValidTaskId(taskId)) return json(res, 400, { ok: false, error: 'invalid_task_id' });
    const cancelled = sardis.agentCancel(taskId);
    if (cancelled.error === 'TASK_NOT_FOUND') return json(res, 404, { ok: false, error: cancelled.error });
    if (cancelled.error === 'invalid_task_id') return json(res, 400, { ok: false, error: cancelled.error });
    if (cancelled.error) return json(res, 409, { ok: false, error: cancelled.error, summary: cancelled.summary || null });
    return json(res, 200, cancelled);
  }
  if (url.pathname.startsWith('/api/')) return json(res, 404, { ok: false, error: 'not_found' });
  const target = safePath(url.pathname); if (!target || !fs.existsSync(target) || !fs.statSync(target).isFile()) { res.writeHead(404); return res.end('Not found'); }
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' }; res.writeHead(200, { 'content-type': types[path.extname(target)] || 'application/octet-stream' }); return fs.createReadStream(target).pipe(res);
}
const server = http.createServer((req, res) => route(req, res, new URL(req.url, `http://${req.headers.host || 'localhost'}`)).catch((error) => json(res, 500, { ok: false, error: String(error.message || error) })));
server.listen(PORT, '127.0.0.1', () => console.log(`Sardis V6 listening on http://127.0.0.1:${PORT}`));
process.on('SIGINT', () => server.close(() => process.exit(0)));


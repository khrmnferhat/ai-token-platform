'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const state = path.join(root, 'data', 'reasoning-live-state.json');
const logFile = path.join(process.env.TEMP || '.', 'sardis-v6-reasoning-live.log');
const port = 3069;
const log = (message) => { fs.appendFileSync(logFile, `${message}\n`); console.log(message); };
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try { const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1000) }); if (response.ok) { log('server-ready'); return; } } catch {}
    await wait(200);
  }
  throw new Error('live server did not start');
}
const server = spawn(process.execPath, ['server.js'], { cwd: root, env: { ...process.env, V6_PORT: String(port), V6_MEMORY_FILE: state, OLLAMA_TIMEOUT_MS: '1000' }, stdio: 'ignore' });
(async () => {
  fs.rmSync(state, { force: true }); fs.writeFileSync(logFile, '');
  await waitForServer();
  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join('tests', 'http-reasoning.test.js')], { cwd: root, env: { ...process.env, V6_URL: `http://127.0.0.1:${port}` }, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (data) => log(`test:${String(data).trim()}`));
    child.stderr.on('data', (data) => log(`test-error:${String(data).trim()}`));
    child.on('error', reject);
    child.on('exit', (value) => resolve(value || 0));
  });
  log(`exit:${code}`); server.kill(); await wait(300); fs.rmSync(state, { force: true }); process.exit(code);
})().catch((error) => { log(`runner-error:${error.stack || error}`); server.kill(); fs.rmSync(state, { force: true }); process.exit(1); });

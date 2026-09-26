'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const state = path.join(root, 'data', 'http-tools-live-state.json');
const port = 3071;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitForServer() { for (let i = 0; i < 50; i += 1) { try { const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1000) }); if (response.ok) return; } catch {} await wait(200); } throw new Error('server did not start'); }
const server = spawn(process.execPath, ['server.js'], { cwd: root, env: { ...process.env, V6_PORT: String(port), V6_MEMORY_FILE: state, OLLAMA_TIMEOUT_MS: '1000' }, stdio: 'ignore' });
(async () => { fs.rmSync(state, { force: true }); await waitForServer(); const code = await new Promise((resolve, reject) => { const child = spawn(process.execPath, [path.join('tests', 'http-tools.test.js')], { cwd: root, env: { ...process.env, V6_URL: `http://127.0.0.1:${port}` }, stdio: 'inherit' }); child.on('error', reject); child.on('exit', (value) => resolve(value || 0)); }); server.kill(); await wait(300); fs.rmSync(state, { force: true }); process.exit(code); })().catch((error) => { console.error(error); server.kill(); fs.rmSync(state, { force: true }); process.exit(1); });

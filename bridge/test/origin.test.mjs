// The bridge publishes onto the live bus, so a browser page on another origin
// must not be able to open it (cross-site WebSocket hijacking).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';

const PORT = 9481;
const bridge = spawn(process.execPath, [new URL('../server.mjs', import.meta.url).pathname], {
  // An unreachable broker keeps the bridge in mock mode, off the live bus.
  env: { ...process.env, BRIDGE_PORT: String(PORT), BROKER_PUB_PORT: '1', BROKER_SUB_PORT: '1' },
  stdio: 'ignore',
});
after(() => bridge.kill());

function open(headers) {
  return new Promise((resolve) => {
    const tryOnce = (left) => {
      const ws = new WebSocket(`ws://127.0.0.1:${PORT}`, { headers });
      ws.on('open', () => { ws.close(); resolve('open'); });
      ws.on('unexpected-response', (_req, res) => resolve(`rejected ${res.statusCode}`));
      ws.on('error', (e) => {
        if (e.code === 'ECONNREFUSED' && left > 0) setTimeout(() => tryOnce(left - 1), 100);
        else if (e.code === 'ECONNREFUSED') resolve('refused');
      });
    };
    tryOnce(50);
  });
}

test('a page on another origin is rejected', async () => {
  assert.match(await open({ Origin: 'https://evil.example' }), /^rejected/);
});

test('the app\'s own origin is accepted', async () => {
  assert.equal(await open({ Origin: 'http://127.0.0.1:5290' }), 'open');
});

test('a non-browser client with no Origin is accepted', async () => {
  assert.equal(await open({}), 'open');
});

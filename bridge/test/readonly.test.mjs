// In production (BRIDGE_READ_ONLY=1) the bridge is public: a browser may
// subscribe but never publish onto the bus.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';

const PORT = 9482;
const bridge = spawn(process.execPath, [new URL('../server.mjs', import.meta.url).pathname], {
  // An unreachable broker keeps the bridge in mock mode, off the live bus.
  env: { ...process.env, BRIDGE_PORT: String(PORT), BROKER_PUB_PORT: '1', BROKER_SUB_PORT: '1',
    BRIDGE_READ_ONLY: '1' },
  stdio: 'ignore',
});
after(() => bridge.kill());

function connect() {
  return new Promise((resolve, reject) => {
    const tryOnce = (left) => {
      const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
      ws.on('open', () => resolve(ws));
      ws.on('error', (e) => {
        if (e.code === 'ECONNREFUSED' && left > 0) setTimeout(() => tryOnce(left - 1), 100);
        else reject(e);
      });
    };
    tryOnce(50);
  });
}

test('a publish is refused and never reaches subscribers', async () => {
  const ws = await connect();
  const got = [];
  ws.on('message', (m) => got.push(JSON.parse(String(m))));
  ws.send(JSON.stringify({ type: 'subscribe', topics: ['orca.estimate'] }));
  ws.send(JSON.stringify({ type: 'publish', envelope: { topic: 'orca.estimate', payload: { x: 1 } } }));
  await new Promise((r) => setTimeout(r, 300));
  ws.close();
  assert.ok(!got.some((m) => m.type === 'envelope'), 'no envelope fanned out');
  assert.ok(!got.some((m) => m.type === 'ack'), 'no ack');
  assert.ok(got.some((m) => m.type === 'error'), 'an error is returned');
});

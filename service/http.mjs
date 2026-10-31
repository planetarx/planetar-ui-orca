// GET /snapshot and /health for the UI (a reloaded page fills from here).
import { createServer } from 'node:http';

export function startHttp(core, port, host = '127.0.0.1') {
  const server = createServer((req, res) => {
    const send = (code, body) => {
      res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
      res.end(JSON.stringify(body));
    };
    if (req.method !== 'GET') return send(405, { error: 'GET only' });
    if (req.url === '/health') return send(200, { ok: true });
    if (req.url === '/snapshot') return send(200, core.snapshot());
    return send(404, { error: 'not found' });
  });
  return new Promise((resolve) => server.listen(port, host, () => resolve(server)));
}

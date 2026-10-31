// GET /snapshot, /health and /track for the UI (a reloaded page fills from here).
import { createServer } from 'node:http';

export function startHttp(core, port, host = '127.0.0.1') {
  const server = createServer((req, res) => {
    const send = (code, body) => {
      res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
      res.end(JSON.stringify(body));
    };
    if (req.method !== 'GET') return send(405, { error: 'GET only' });
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/health') return send(200, { ok: true, startedNs: core.startedNs });
    if (url.pathname === '/snapshot') return send(200, core.snapshot());
    if (url.pathname === '/track') {
      const mmsi = Number(url.searchParams.get('mmsi'));
      let from;
      let to;
      try {
        from = BigInt(url.searchParams.get('from') ?? '0');
        to = BigInt(url.searchParams.get('to') ?? String(BigInt(Date.now()) * 1_000_000n));
      } catch {
        return send(400, { error: 'from/to must be ns integers' });
      }
      if (!Number.isInteger(mmsi) || mmsi <= 0) return send(400, { error: 'mmsi must be a number' });
      return send(200, { mmsi, points: core.track(mmsi, from, to) });
    }
    return send(404, { error: 'not found' });
  });
  return new Promise((resolve) => server.listen(port, host, () => resolve(server)));
}

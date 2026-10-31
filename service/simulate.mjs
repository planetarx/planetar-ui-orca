// Replay a scenario onto the bus as sim.vessel.ais.position (all simulated;
// a separate topic so planetar-ontology and planetar-ui never store the fake vessels).
//   node service/simulate.mjs service/scenarios/race-rocks.json [--speed 10]
// --speed compresses wall time only; positions keep scenario time stamps.

import { readFileSync } from 'node:fs';
import { BrokerLink } from './bus.mjs';
import { scenarioPositions } from './sim.mjs';

const [file, ...rest] = process.argv.slice(2);
if (!file) { console.error('usage: simulate.mjs <scenario.json> [--speed N]'); process.exit(2); }
const speed = Number(rest[rest.indexOf('--speed') + 1] ?? 1) || 1;
const scenario = JSON.parse(readFileSync(file, 'utf8'));
const startNs = BigInt(Date.now()) * 1_000_000n;
const positions = scenarioPositions(scenario, startNs);
const link = new BrokerLink().start();

await new Promise((r) => { const t = setInterval(() => { if (link.pubReady) { clearInterval(t); r(); } }, 100); });
const wall0 = Date.now();
console.log(`[simulate] ${scenario.name}: ${positions.length} positions over ${scenario.durationMin} min at ${speed}x (SIMULATED)`);
for (const { atNs, pos } of positions) {
  const due = wall0 + Number(atNs - startNs) / 1e6 / speed;
  const wait = due - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  link.publish('sim.vessel.ais.position', 'vessel.ais.Position.v1', pos);
}
console.log('[simulate] done');
setTimeout(() => process.exit(0), 500);

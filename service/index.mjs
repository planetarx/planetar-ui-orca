// The inference service: vessel.ais.position → orca.evidence / orca.estimate
// on the bus, plus GET /snapshot and /health on ORCA_SERVICE_PORT (9410).
// OrcaHello hydrophone detections come off the bus (acoustic.orcahello, published by
// planetar-acoustic/orcahello) unless ORCAHELLO=off.

import { BrokerLink } from './bus.mjs';
import { createInferenceService } from './core.mjs';
import { startHttp } from './http.mjs';
import { loadConfig, loadHarbours, loadVessels } from './load.mjs';
import { createDetectionGate, ORCAHELLO_TOPIC } from './orcahello.mjs';

const PORT = Number(process.env.ORCA_SERVICE_PORT ?? 9410);
const config = loadConfig();

let link;
const core = createInferenceService({
  config, harbours: loadHarbours(), vessels: loadVessels(),
  publish: (topic, schemaName, payload) => link.publish(topic, schemaName, payload),
});
const hydrophones = process.env.ORCAHELLO !== 'off';
const newDetection = createDetectionGate();
link = new BrokerLink({
  topics: ['vessel.ais.position', 'sim.vessel.ais.position', ...(hydrophones ? [ORCAHELLO_TOPIC] : [])],
  onEnvelope: (env) => {
    if (!env.payload || typeof env.payload !== 'object') return;
    if (env.topic === ORCAHELLO_TOPIC) { if (newDetection(env.payload)) core.onHydrophone(env.payload); return; }
    core.onPosition(env.payload);
  },
}).start();
setInterval(() => core.tick(), 60_000);
await startHttp(core, PORT);
console.log(`[orca-service] http://127.0.0.1:${PORT}/snapshot · ${loadVessels().size} listed vessels`);

// The inference service: vessel.ais.position → orca.evidence / orca.estimate
// on the bus, plus GET /snapshot and /health on ORCA_SERVICE_PORT (9410).

import { BrokerLink } from './bus.mjs';
import { createInferenceService } from './core.mjs';
import { startHttp } from './http.mjs';
import { loadConfig, loadHarbours, loadVessels } from './load.mjs';

const PORT = Number(process.env.ORCA_SERVICE_PORT ?? 9410);

let link;
const core = createInferenceService({
  config: loadConfig(), harbours: loadHarbours(), vessels: loadVessels(),
  publish: (topic, schemaName, payload) => link.publish(topic, schemaName, payload),
});
link = new BrokerLink({
  topics: ['vessel.ais.position', 'sim.vessel.ais.position'],
  onEnvelope: (env) => { if (env.payload && typeof env.payload === 'object') core.onPosition(env.payload); },
}).start();
setInterval(() => core.tick(), 60_000);
await startHttp(core, PORT);
console.log(`[orca-service] http://127.0.0.1:${PORT}/snapshot · ${loadVessels().size} listed vessels`);

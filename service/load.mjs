// Loads the inference's hand-edited inputs: thresholds, harbours, vessel list.

import { readFileSync } from 'node:fs';

const here = (rel) => new URL(rel, import.meta.url);
const readJson = (url) => JSON.parse(readFileSync(url, 'utf8'));

export const loadConfig = (path = here('./config/inference.json')) => readJson(path);
export const loadHarbours = (path = here('./data/harbours.json')) => readJson(path).harbours;
/** → Map<mmsi, {mmsi, name, operator, verified, simulated}> */
export const loadVessels = (path = here('./data/whale-watch-vessels.json')) =>
  new Map(readJson(path).vessels.map((v) => [v.mmsi, v]));

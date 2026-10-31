# planetar-ui-orca

Where are the whales around Victoria, BC right now, and **why do we think so?**

A sibling of [planetar-ui](https://github.com/planetarx/planetar-ui) for one mission: tracking whales (orcas above all) from the behaviour of whale-watching boats in live AIS, with every estimate traceable to the sensor data behind it. Sources are listed on the left; click one to see its live stream; the map and inspector on the right show each estimate and the evidence it rests on.

Design: [`docs/superpowers/specs/2026-10-31-planetar-ui-orca-design.md`](docs/superpowers/specs/2026-10-31-planetar-ui-orca-design.md). Wire contract: [`docs/CONTRACT.md`](docs/CONTRACT.md).

## Run (on bb, beside the planetar pm2 tier)

```
npm install
npm run dev          # Vite :5290 + bridge ws://127.0.0.1:9400 + inference service :9410
npm run test:service # node:test, the inference
npm test             # Playwright (bundled Chromium)
```

The bridge and the service connect to the running planetar broker (12001 publish, 12002 subscribe). Don't start a second broker.

## Status (2026-10-31)

Being built from the plan in `docs/superpowers/plans/`.

License: GPL-3.0-or-later.

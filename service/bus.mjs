// TCP link to planetar-broker: publish on 12001, subscribe on 12002.
// Reconnects every 2 s; publishes while disconnected are dropped.

import net from 'node:net';
import { decodeEnvelope, encodeEnvelope, frameTCP, TCPFrameParser } from '../bridge/zmesg.mjs';
import { uuidv7 } from './ids.mjs';

const HOST = process.env.BROKER_HOST ?? '127.0.0.1';
const PUB = Number(process.env.BROKER_PUB_PORT ?? 12001);
const SUB = Number(process.env.BROKER_SUB_PORT ?? 12002);
const SOURCE = 'planetar-ui-orca/service';

export class BrokerLink {
  /** topics: subscriptions (may be empty for a publish-only link). */
  constructor({ topics = [], onEnvelope = () => {}, log = console.log } = {}) {
    Object.assign(this, { topics, onEnvelope, log, pub: null, pubReady: false });
  }

  start() {
    this.connectPub();
    if (this.topics.length) this.connectSub();
    return this;
  }

  connectPub() {
    const s = net.connect({ host: HOST, port: PUB });
    s.setNoDelay(true);
    s.on('connect', () => { this.pub = s; this.pubReady = true; this.log(`[bus] publishing to ${HOST}:${PUB}`); });
    s.on('error', () => {});
    s.on('close', () => { this.pubReady = false; setTimeout(() => this.connectPub(), 2000); });
  }

  connectSub() {
    const s = net.connect({ host: HOST, port: SUB });
    const parser = new TCPFrameParser();
    let handshake = Buffer.alloc(0);
    let ok = false;
    s.on('connect', () => s.write(`SUB ${this.topics.join(' ')}\n`));
    s.on('data', (chunk) => {
      if (!ok) {
        handshake = Buffer.concat([handshake, chunk]);
        const nl = handshake.indexOf(0x0a);
        if (nl < 0) return;
        const line = handshake.subarray(0, nl).toString();
        if (!line.startsWith('OK')) { this.log(`[bus] SUB rejected: ${line}`); s.destroy(); return; }
        ok = true;
        this.log(`[bus] subscribed to ${this.topics.join(' ')} on ${HOST}:${SUB}`);
        chunk = handshake.subarray(nl + 1);
        if (!chunk.length) return;
      }
      parser.push(chunk, (frame) => {
        try { this.onEnvelope(decodeEnvelope(frame)); } catch (e) { this.log(`[bus] decode error: ${e.message}`); }
      });
    });
    s.on('error', () => {});
    s.on('close', () => setTimeout(() => this.connectSub(), 2000));
  }

  publish(topic, schemaName, payload) {
    if (!this.pubReady) return false;
    const ns = BigInt(Date.now()) * 1_000_000n;
    this.pub.write(frameTCP(encodeEnvelope({ id: uuidv7(), topic, source: SOURCE, schemaName,
      createdAtNs: ns, payload })));
    return true;
  }
}

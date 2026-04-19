/**
 * Trinity SDK / Planespace / Trinity Core
 * Copyright (c) 2026 James Chapman (XheCarpenXer)
 *
 * Author: James Chapman
 * Alias: XheCarpenXer
 * Contact: xhecarpenxer@gmail.com
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * This software is dual-licensed:
 * 1. Open Source License: GNU Affero General Public License v3.0 or later (AGPLv3+).
 * 2. Commercial / Government License: available for private, closed-source, warranty-backed,
 *    or separately negotiated terms beyond AGPL compliance.
 *
 * See: LICENSE, COMMERCIAL-LICENSE.md, FEE-SCHEDULE.md, CLA.md, LEGAL-NOTES.md
 * THIS SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.
 */

/**
 * TRINITY — trinity.js
 *
 * Composition root only:
 *   1. Load module surfaces
 *   2. Instantiate layers in dependency order
 *   3. Wire interfaces together
 */

'use strict';

let _nodeModulesReady = false;

async function boot(opts = {}) {
  await _ensureLocalModules();
  const cfg = _config(opts);

  const identityApi = _get('TrinityIdentity', _shimIdentity());
  const identity = identityApi.ensureIdentity(cfg.name);
  const wallet = _createWallet(identity, _get('TrinityWallet'), identityApi);

  const log = _createLog();
  const bus = _createBus();
  const ledger = _createLedger();
  const transport = _createTransport({
    nodeId:            identity.id,
    api:               cfg.api,
    validatorEndpoint: cfg.validatorEndpoint,
    rtc:               cfg.enableRTC,
    sse:               cfg.enableSSE,
    local:             cfg.enableLocal,
  });

  const network = await _attachNetwork({ log, transport, nodeId: identity.id });
  const compute = _createCompute(log);

  const ai = cfg.enableOllama
    ? await _safeCall(() => _get('initializeAI')?.({ model: cfg.ollamaModel, host: cfg.ollamaHost }))
    : null;

  const economy = _createEconomy(log, wallet);

  log.on('event', event => {
    transport.send({
      nonce:    event.id || _nonce(),
      type:     event.type,
      payload:  event.payload,
      authorId: event.authorId,
      ts:       event.ts,
      hash:     event.hash,
    });
  });

  transport.on('*', envelope => {
    if (envelope?.type && envelope?.authorId !== identity.id) {
      _safeCall(() => network.receiveRemoteEvent(envelope));
    }
  });

  console.log(`[TRINITY] ${identity.id.slice(0, 12)}... online`);

  return {
    identity,
    wallet,
    log,
    bus,
    ledger,
    transport,
    network,
    compute,
    ai,
    economy,
    emit: (type, payload) => log.emit({ type, payload, authorId: identity.id }),
    state: () => log.getState?.() ?? {},
    on: (type, fn) => { log.on(type, fn); },
    peers: () => transport.peers(),
    diagnostics: () => ({
      nodeId:         identity.id,
      name:           identity.name,
      peers:          transport.peers().length,
      transportReady: transport.ready,
      eventCount:     log.getEvents?.().length ?? 0,
      apps:           Object.keys(economy.getApps()).length,
    }),
  };
}

function _config(opts) {
  return {
    name:              opts.name              ?? '',
    api:               opts.api               ?? 'http://localhost:3000/api',
    validatorEndpoint: opts.validatorEndpoint ?? null,
    enableRTC:         opts.enableRTC         ?? (typeof RTCPeerConnection !== 'undefined'),
    enableSSE:         opts.enableSSE         ?? (typeof EventSource !== 'undefined'),
    enableLocal:       opts.enableLocal       ?? (typeof BroadcastChannel !== 'undefined'),
    enableOllama:      opts.enableOllama      ?? false,
    ollamaModel:       opts.ollamaModel       ?? 'mistral',
    ollamaHost:        opts.ollamaHost        ?? 'http://localhost:11434',
  };
}

function _get(name, fallback = null) {
  if (typeof globalThis !== 'undefined' && globalThis[name] != null) return globalThis[name];
  if (typeof window !== 'undefined' && window[name] != null) return window[name];
  return fallback;
}

function _register(name, value) {
  if (value == null || typeof globalThis === 'undefined' || globalThis[name] != null) return;
  globalThis[name] = value;
}

async function _ensureLocalModules() {
  if (_nodeModulesReady || typeof module === 'undefined' || !module.exports || typeof require !== 'function') return;
  _nodeModulesReady = true;

  _register('TrinityWallet', _safeRequire('./crypto/wallet.js'));
  _register('TrinityIdentity', _safeRequire('./primitives/identity.js'));

  const transport = _safeRequire('./transport/transport.js');
  if (transport?.createTransport) _register('TrinityTransport', transport);

  const economy = _safeRequire('./policy/economy.js');
  if (economy?.TrinityEconomy) _register('TrinityEconomy', economy.TrinityEconomy);
}

function _safeRequire(path) {
  try { return require(path); } catch { return null; }
}

function _createWallet(identity, walletApi, identityApi) {
  const base = walletApi || {};
  return {
    ...base,
    address: identity?.id || _randomAddress(),
    sign: async message => {
      if (identityApi?.sign) return identityApi.sign(identity, message);
      if (base.sign && identity?.keyHex) return base.sign(message, identity.keyHex);
      return null;
    },
    verify: async (message, signature) => {
      if (identityApi?.verify) return identityApi.verify(message, signature, identity?.id);
      return false;
    },
  };
}

function _createLog() {
  const Cls = _get('SovereignLog');
  if (Cls) try { return new Cls(); } catch {}
  return _shimLog();
}

function _createBus() {
  const attach = _get('attachBus');
  const broadcastRestore = _get('broadcastRestore');
  if (typeof attach === 'function' && typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined') {
    _safeCall(() => attach());
    return {
      ready: true,
      attach,
      broadcastRestore: typeof broadcastRestore === 'function' ? broadcastRestore : () => {},
    };
  }
  return null;
}

function _createLedger() {
  const Cls = _get('SovereignLedgerBridge');
  if (Cls) try { return new Cls(); } catch {}
  return null;
}

function _createTransport(opts) {
  const api = _get('TrinityTransport');
  if (api?.createTransport) {
    try { return api.createTransport(opts); } catch {}
  }
  return _shimTransport();
}

function _createCompute(log) {
  const Cls = _get('SovereignComputeBridge');
  if (Cls) try { return new Cls(log); } catch {}
  return null;
}

function _createEconomy(log, wallet) {
  const Cls = _get('TrinityEconomy');
  if (Cls) try { return new Cls(log, wallet); } catch {}
  return _shimEconomy();
}

async function _attachNetwork({ log, transport, nodeId }) {
  const attach = _get('attachNetwork');
  if (attach) return attach({ log, transport, nodeId });
  const Cls = _get('SovereignNetwork');
  if (Cls) return new Cls({ log, nodeId });
  return {
    receiveRemoteEvent: async envelope =>
      log.emit({
        type:     envelope.type,
        payload:  envelope.payload,
        authorId: envelope.authorId || 'remote',
      }),
  };
}

async function _safeCall(fn) {
  try { return await fn(); } catch { return null; }
}

function _shimIdentity() {
  return {
    ensureIdentity(name = '') {
      return { id: _randomAddress(), name, keyHex: '', ts: Date.now(), canSign: false };
    },
    sign: async () => null,
    verify: async () => false,
  };
}

function _shimLog() {
  const events = [];
  const handlers = {};
  let seq = 0;
  let prevHash = '0000000000000000';

  return {
    emit(event) {
      const record = {
        ...event,
        id: event.id || _nonce(),
        seq,
        ts: event.ts ?? Date.now(),
      };
      record.hash = _fnv32(JSON.stringify({
        type:     record.type,
        payload:  record.payload,
        authorId: record.authorId,
        seq:      record.seq,
        ts:       record.ts,
      }) + '|' + prevHash);
      record.prevHash = prevHash;
      prevHash = record.hash;
      seq += 1;
      events.push(record);
      _notify(handlers, record);
      return record;
    },
    on(type, fn) {
      (handlers[type] = handlers[type] || []).push(fn);
    },
    getEvents() {
      return events.slice();
    },
    getState() {
      return { eventCount: events.length, headHash: prevHash };
    },
  };
}

function _notify(handlers, record) {
  const fns = [
    ...(handlers[record.type] || []),
    ...(handlers.event || []),
    ...(handlers['*'] || []),
  ];
  for (const fn of fns) {
    try { fn(record); } catch {}
  }
}

function _shimTransport() {
  const handlers = {};
  if (typeof BroadcastChannel !== 'undefined') {
    const bc = new BroadcastChannel('trinity-bus');
    const transport = {
      ready: true,
      _transports: [],
      send: envelope => bc.postMessage(envelope),
      on(type, fn) {
        (handlers[type] = handlers[type] || []).push(fn);
        return transport;
      },
      peers() { return []; },
    };
    bc.onmessage = event => {
      const envelope = event.data;
      const fns = [...(handlers[envelope?.type] || []), ...(handlers['*'] || [])];
      for (const fn of fns) {
        try { fn(envelope); } catch {}
      }
    };
    return transport;
  }
  return {
    ready: false,
    _transports: [],
    send() {},
    on() { return this; },
    peers() { return []; },
  };
}

function _shimEconomy() {
  return {
    getApps: () => ({}),
    getNodes: () => ({}),
    getBets: () => ({}),
    getApp: () => null,
    getLeaderboard: () => [],
    getNodeHealth: () => null,
  };
}

function _fnv32(str) {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function _randomAddress() {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const bytes = new Uint8Array(20);
    crypto.getRandomValues(bytes);
    return '0x' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  return '0x' + _nonce().replace(/[^a-f0-9]/gi, '').padEnd(40, '0').slice(0, 40).toLowerCase();
}

function _nonce() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

if (typeof module !== 'undefined' && module.exports) module.exports = { boot };
else if (typeof window !== 'undefined') window.Trinity = { boot };

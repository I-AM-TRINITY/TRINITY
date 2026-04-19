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
 * TRINITY TRANSPORT INTERFACE
 * ───────────────────────────────────────────────────────────────────────────
 * Every transport variant implements this interface.
 * The network layer above never touches WebRTC, SSE, or sockets directly.
 *
 * Variants:
 *   LocalTransport       — BroadcastChannel (same device, cross-tab)
 *   SSETransport         — HTTP Server-Sent Events (Web2, firewall-friendly)
 *   WebRTCTransport      — PeerJS DataChannel (Web3, true P2P after handshake)
 *   ValidatorTransport   — HTTP validator endpoint (high-throughput, online only)
 *
 * The internet is used ONLY to bootstrap (STUN/signaling).
 * Once WebRTC channels open, messages flow peer-to-peer with no server.
 */

'use strict';

// ── Base interface (extend this) ────────────────────────────────────────────
class BaseTransport {
  constructor(opts = {}) {
    this._handlers = {};  // type → [fn]
    this.id = opts.id || _nonce();
    this._ready = false;
  }

  get ready() {
    return this._ready;
  }

  set ready(value) {
    this._ready = Boolean(value);
  }

  /** Emit an event envelope to all reachable peers */
  send(envelope) { throw new Error('send() not implemented'); }

  /** Subscribe to incoming events by type (* = all) */
  on(type, fn) {
    (this._handlers[type] = this._handlers[type] || []).push(fn);
    return this;
  }

  off(type, fn) {
    this._handlers[type] = (this._handlers[type] || []).filter(f => f !== fn);
    return this;
  }

  /** Array of connected peer IDs */
  peers() { return []; }

  /** Graceful teardown */
  close() {}

  // Internal: deliver to local handlers
  _deliver(envelope) {
    const fns = [...(this._handlers[envelope.type] || []), ...(this._handlers['*'] || [])];
    for (const fn of fns) try { fn(envelope); } catch (e) { console.warn('[transport] handler error', e); }
  }
}

// ── LocalTransport: BroadcastChannel (cross-tab, same device) ──────────────
class LocalTransport extends BaseTransport {
  constructor(opts = {}) {
    super(opts);
    this._channel = new BroadcastChannel(opts.channel || 'trinity-bus');
    this._channel.onmessage = e => this._deliver(e.data);
    this.ready = true;
  }

  send(envelope) {
    this._channel.postMessage(envelope);
  }

  close() { this._channel.close(); }
}

// ── SSETransport: Server-Sent Events (Web2 lane) ────────────────────────────
class SSETransport extends BaseTransport {
  constructor(opts = {}) {
    super(opts);
    this._api = (opts.api || 'http://localhost:3000/api').replace(/\/$/, '');
    this._es = null;
    this._reconnectMs = opts.reconnectMs || 4000;
    this._connect();
  }

  _connect() {
    const url = `${this._api}/events?userId=${encodeURIComponent(this.id)}`;
    this._es = new EventSource(url);
    this._es.onopen = () => { this.ready = true; };
    this._es.onmessage = e => {
      try { this._deliver(JSON.parse(e.data)); } catch {}
    };
    this._es.onerror = () => {
      this.ready = false;
      setTimeout(() => this._connect(), this._reconnectMs);
    };
  }

  send(envelope) {
    fetch(`${this._api}/broadcast`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(envelope),
    }).catch(() => {});
  }

  close() { this._es?.close(); }
}

// ── WebRTCTransport: PeerJS DataChannel (Web3 lane) ─────────────────────────
// Bootstraps via internet STUN/signaling, then pure P2P.
class WebRTCTransport extends BaseTransport {
  constructor(opts = {}) {
    super(opts);
    this._peers = new Map(); // peerId → RTCPeerConnection
    this._channels = new Map(); // peerId → RTCDataChannel
    this._api = (opts.api || 'http://localhost:3000/api').replace(/\/$/, '');
    this._iceServers = opts.iceServers || [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ];

    if (typeof RTCPeerConnection !== 'undefined') {
      this._registerWithSignaling();
    }
  }

  // Register so other peers can find us via server signaling
  _registerWithSignaling() {
    fetch(`${this._api}/rtc/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ peerId: this.id }),
    }).catch(() => {});

    // Poll for incoming offers/answers/candidates
    this._signalingPoll = setInterval(() => this._pollSignaling(), 2000);
  }

  async _pollSignaling() {
    try {
      const r = await fetch(`${this._api}/rtc/inbox?peerId=${this.id}`);
      if (!r.ok) return;
      const msgs = await r.json();
      for (const msg of msgs) await this._handleSignal(msg);
    } catch {}
  }

  async connect(remotePeerId) {
    if (this._peers.has(remotePeerId)) return;
    const pc = new RTCPeerConnection({ iceServers: this._iceServers });
    this._peers.set(remotePeerId, pc);
    const dc = pc.createDataChannel('trinity');
    this._setupDataChannel(dc, remotePeerId);
    pc.onicecandidate = e => {
      if (e.candidate) this._sendSignal(remotePeerId, { type: 'candidate', candidate: e.candidate });
    };
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this._sendSignal(remotePeerId, { type: 'offer', sdp: offer, from: this.id });
  }

  async _handleSignal(msg) {
    if (msg.type === 'offer') {
      const pc = new RTCPeerConnection({ iceServers: this._iceServers });
      this._peers.set(msg.from, pc);
      pc.ondatachannel = e => this._setupDataChannel(e.channel, msg.from);
      pc.onicecandidate = e => {
        if (e.candidate) this._sendSignal(msg.from, { type: 'candidate', candidate: e.candidate });
      };
      await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this._sendSignal(msg.from, { type: 'answer', sdp: answer, from: this.id });
    } else if (msg.type === 'answer') {
      const pc = this._peers.get(msg.from);
      if (pc) await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
    } else if (msg.type === 'candidate') {
      const pc = this._peers.get(msg.from);
      if (pc) await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
    }
  }

  _setupDataChannel(dc, peerId) {
    this._channels.set(peerId, dc);
    dc.onopen = () => { this.ready = true; };
    dc.onmessage = e => {
      try { this._deliver(JSON.parse(e.data)); } catch {}
    };
    dc.onclose = () => this._channels.delete(peerId);
  }

  _sendSignal(toPeerId, msg) {
    fetch(`${this._api}/rtc/signal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: toPeerId, from: this.id, ...msg }),
    }).catch(() => {});
  }

  send(envelope) {
    const str = JSON.stringify(envelope);
    let sent = false;
    for (const [, dc] of this._channels) {
      if (dc.readyState === 'open') {
        try { dc.send(str); sent = true; } catch {}
      }
    }
    return sent;
  }

  peers() { return [...this._channels.keys()]; }

  close() {
    clearInterval(this._signalingPoll);
    for (const [, pc] of this._peers) try { pc.close(); } catch {}
  }
}

// ── ValidatorTransport: HTTP endpoint (high-TPS, online only) ───────────────
class ValidatorTransport extends BaseTransport {
  constructor(opts = {}) {
    super(opts);
    this._endpoint = opts.endpoint;
    this._fallbackTimeout = opts.fallbackTimeout || 2000;
    this._online = false;
    this._checkHealth();
    setInterval(() => this._checkHealth(), 15000);
  }

  async _checkHealth() {
    if (!this._endpoint) return;
    try {
      const r = await fetch(`${this._endpoint}/health`, { signal: AbortSignal.timeout(2000) });
      this._online = r.ok;
      this.ready = this._online;
    } catch {
      this._online = false;
      this.ready = false;
    }
  }

  async send(envelope) {
    if (!this._online || !this._endpoint) return false;
    try {
      await fetch(`${this._endpoint}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(envelope),
        signal: AbortSignal.timeout(this._fallbackTimeout),
      });
      return true;
    } catch { return false; }
  }

  get isOnline() { return this._online; }
}

// ── MultiTransport: runs all available transports simultaneously ─────────────
// This is what the network layer uses. It dispatches to all transports and
// deduplicates incoming messages by nonce.
class MultiTransport extends BaseTransport {
  constructor(transports = []) {
    super();
    this._transports = transports;
    this._seen = new Set();
    this._ring = [];

    for (const t of transports) {
      t.on('*', envelope => {
        if (this._dedupe(envelope.nonce)) return;
        this._deliver(envelope);
      });
    }
  }

  _dedupe(nonce) {
    if (!nonce || this._seen.has(nonce)) return true;
    this._seen.add(nonce);
    this._ring.push(nonce);
    if (this._ring.length > 1024) this._seen.delete(this._ring.shift());
    return false;
  }

  send(envelope) {
    if (!envelope.nonce) envelope.nonce = _nonce();
    for (const t of this._transports) t.send(envelope);
  }

  peers() {
    return [...new Set(this._transports.flatMap(t => t.peers()))];
  }

  get ready() {
    return this._transports.some(t => t.ready);
  }

  /** Best available transport for latency-sensitive sends */
  get preferred() {
    // ValidatorTransport > WebRTC > SSE > Local
    return (
      this._transports.find(t => t instanceof ValidatorTransport && t.isOnline) ||
      this._transports.find(t => t instanceof WebRTCTransport && t.ready) ||
      this._transports.find(t => t instanceof SSETransport && t.ready) ||
      this._transports[0]
    );
  }

  close() { for (const t of this._transports) t.close(); }
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function _nonce() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const b = new Uint8Array(12);
    crypto.getRandomValues(b);
    return Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('');
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// ── Factory ──────────────────────────────────────────────────────────────────
/**
 * Create the right transport stack for the current environment.
 *
 * @param {object} opts
 * @param {string} opts.nodeId          - this node's ID
 * @param {string} [opts.api]           - local server API base URL
 * @param {string} [opts.validatorEndpoint] - optional validator URL
 * @param {boolean} [opts.local]        - include BroadcastChannel (default: true in browser)
 * @param {boolean} [opts.sse]          - include SSE (default: true)
 * @param {boolean} [opts.rtc]          - include WebRTC (default: true in browser)
 */
function createTransport(opts = {}) {
  const transports = [];
  const inBrowser = typeof window !== 'undefined';

  if (opts.local !== false && inBrowser && typeof BroadcastChannel !== 'undefined') {
    transports.push(new LocalTransport({ id: opts.nodeId, channel: 'trinity-bus' }));
  }
  if (opts.sse !== false) {
    transports.push(new SSETransport({ id: opts.nodeId, api: opts.api }));
  }
  if (opts.rtc !== false && inBrowser && typeof RTCPeerConnection !== 'undefined') {
    transports.push(new WebRTCTransport({ id: opts.nodeId, api: opts.api }));
  }
  if (opts.validatorEndpoint) {
    transports.push(new ValidatorTransport({ endpoint: opts.validatorEndpoint }));
  }

  return new MultiTransport(transports);
}

// ── Exports ──────────────────────────────────────────────────────────────────
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { BaseTransport, LocalTransport, SSETransport, WebRTCTransport, ValidatorTransport, MultiTransport, createTransport };
} else if (typeof window !== 'undefined') {
  window.TrinityTransport = { LocalTransport, SSETransport, WebRTCTransport, ValidatorTransport, MultiTransport, createTransport };
}

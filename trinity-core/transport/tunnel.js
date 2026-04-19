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
 * TRINITY TUNNEL — tunnel.js
 * Zero dependencies. Browser + Node.js compatible.
 *
 * Provides a unified message bus that spans:
 *   Web2 lane  — HTTP Server-Sent Events (SSE)
 *                persistent, firewall-friendly, works everywhere
 *   Web3 lane  — WebRTC DataChannel mesh
 *                truly P2P, server-free once negotiated
 *
 * Usage (browser):
 *   <script src="tunnel.js"></script>
 *   <script>
 *     const t = new TrinityTunnel({ api: 'http://localhost:3000/api', userId: 'alice' });
 *     t.on('MESSAGE', payload => console.log(payload));
 *     t.send('PING', { hello: 'world' });   // goes to all peers via best available lane
 *   </script>
 *
 * Usage (Node.js — Web2 only, no WebRTC):
 *   const { TrinityTunnel } = require('./tunnel');
 *   const t = new TrinityTunnel({ api: 'http://localhost:3000/api', userId: 'bot' });
 *
 * Design principles:
 *   • Both tunnels run SIMULTANEOUSLY — no fallback, no switching.
 *   • Deduplication: every message carries a nonce; duplicates are dropped.
 *   • Graceful degradation: if WebRTC unavailable, SSE carries everything.
 *   • Offline-safe: messages queue until a lane comes back up.
 */

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();               // Node.js
  } else {
    root.TrinityTunnel = factory();           // Browser global
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];

  // ── Deduplication ring buffer ──────────────────────────────────────────
  function makeDeduper(size = 512) {
    const seen = new Set();
    const ring = [];
    return {
      check(id) {
        if (seen.has(id)) return true;      // duplicate
        seen.add(id);
        ring.push(id);
        if (ring.length > size) seen.delete(ring.shift());
        return false;
      },
    };
  }

  // ── Tiny nonce generator ──────────────────────────────────────────────
  function nonce() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      const b = new Uint8Array(12);
      crypto.getRandomValues(b);
      return Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('');
    }
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  // ════════════════════════════════════════════════════════════════════════
  class TrinityTunnel {
    /**
     * @param {object} opts
     * @param {string} opts.api      - base URL, e.g. 'http://localhost:3000/api'
     * @param {string} opts.userId   - local peer identifier
     * @param {boolean} [opts.rtc]   - enable WebRTC (default: true in browser)
     * @param {boolean} [opts.sse]   - enable SSE (default: true)
     * @param {number}  [opts.reconnectMs] - SSE reconnect delay (default: 4000)
     */
    constructor(opts = {}) {
      this.api         = (opts.api || 'http://localhost:3000/api').replace(/\/$/, '');
      this.userId      = opts.userId || nonce();
      this.rtcEnabled  = opts.rtc !== false && typeof RTCPeerConnection !== 'undefined';
      this.sseEnabled  = opts.sse !== false;
      this.reconnectMs = opts.reconnectMs || 4_000;

      this._listeners  = {};       // type → [fn]
      this._dedup      = makeDeduper();
      this._queue      = [];       // offline message queue
      this._peers      = new Map(); // peerId → { pc, dc, ready }
      this._sseReady   = false;
      this._es         = null;

      if (this.rtcEnabled)  this._bindSignaling();
      if (this.sseEnabled)  this._sseConnect();
      if (this.rtcEnabled)  this._rtcSelf();
    }

    // ── Subscribe ──────────────────────────────────────────────────────────
    on(type, fn) {
      (this._listeners[type] = this._listeners[type] || []).push(fn);
      return this;
    }

    off(type, fn) {
      this._listeners[type] = (this._listeners[type] || []).filter(f => f !== fn);
      return this;
    }

    // ── Send (both lanes simultaneously) ──────────────────────────────────
    send(type, payload) {
      const msg = { nonce: nonce(), from: this.userId, type, payload, ts: Date.now() };
      let sent  = false;

      // Web3 lane — direct P2P if available
      for (const [, p] of this._peers) {
        if (p.dc?.readyState === 'open') {
          try { p.dc.send(JSON.stringify(msg)); sent = true; } catch {}
        }
      }

      // Web2 lane — post to server (server fans out via SSE)
      this._post(`/internal/broadcast`, msg).catch(() => {});

      if (!sent) this._queue.push(msg);
      return this;
    }

    // ── Drain offline queue ───────────────────────────────────────────────
    _drain() {
      while (this._queue.length) {
        const m = this._queue.shift();
        this.send(m.type, m.payload);
      }
    }

    // ── Dispatch received message ─────────────────────────────────────────
    _dispatch(msg) {
      if (!msg || !msg.type) return;
      if (this._dedup.check(msg.nonce || msg.type + msg.ts)) return;
      const fns = [
        ...(this._listeners[msg.type] || []),
        ...(this._listeners['*']      || []),
      ];
      fns.forEach(fn => { try { fn(msg.payload, msg); } catch {} });
    }

    // ════════════════════════════════════════════════════════════════════════
    // WEB2 LANE — SSE
    // ════════════════════════════════════════════════════════════════════════
    _sseConnect() {
      if (typeof EventSource === 'undefined') {
        // Node.js: use http GET with chunked response
        this._nodeSSE();
        return;
      }
      try {
        const url = `${this.api}/stream?userId=${encodeURIComponent(this.userId)}`;
        this._es  = new EventSource(url);

        this._es.addEventListener('message', ev => {
          try { this._dispatch(JSON.parse(ev.data)); } catch {}
        });

        this._es.addEventListener('open', () => {
          this._sseReady = true;
          console.log('[Tunnel/SSE] connected');
          this._drain();
        });

        this._es.addEventListener('error', () => {
          this._sseReady = false;
          this._es.close();
          setTimeout(() => this._sseConnect(), this.reconnectMs);
        });
      } catch (e) {
        setTimeout(() => this._sseConnect(), this.reconnectMs);
      }
    }

    // Node.js SSE fallback (no EventSource)
    _nodeSSE() {
      try {
        const http    = require('http');
        const https   = require('https');
        const url     = new URL(`${this.api}/stream?userId=${encodeURIComponent(this.userId)}`);
        const mod     = url.protocol === 'https:' ? https : http;
        const req     = mod.get(url, res => {
          res.setEncoding('utf8');
          let buf = '';
          res.on('data', chunk => {
            buf += chunk;
            const parts = buf.split('\n\n');
            buf = parts.pop();
            parts.forEach(part => {
              const dataPart = part.split('\n').find(l => l.startsWith('data:'));
              if (dataPart) {
                try { this._dispatch(JSON.parse(dataPart.slice(5))); } catch {}
              }
            });
          });
          res.on('end', () => setTimeout(() => this._nodeSSE(), this.reconnectMs));
        });
        req.on('error', () => setTimeout(() => this._nodeSSE(), this.reconnectMs));
      } catch {}
    }

    // ════════════════════════════════════════════════════════════════════════
    // WEB3 LANE — WebRTC DataChannel mesh
    // ════════════════════════════════════════════════════════════════════════

    // Announce self, then connect to any existing peers
    async _rtcSelf() {
      try {
        const res  = await this._post('/rtc/offer-probe', { peerId: this.userId });
        const data = await res.json();
        (data.peers || []).forEach(p => {
          if (p.peerId !== this.userId) this.rtcConnect(p.peerId);
        });
      } catch {}
    }

    async rtcConnect(peerId) {
      if (this._peers.has(peerId)) return;
      const state = this._makePeer(peerId, false /* offerer */);

      try {
        const offer = await state.pc.createOffer();
        await state.pc.setLocalDescription(offer);
        await this._post('/rtc/offer', { peerId: this.userId, offer });
      } catch {}
    }

    _makePeer(peerId, polite) {
      const pc    = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      const state = { pc, dc: null, polite };
      this._peers.set(peerId, state);

      if (!polite) {
        const dc = pc.createDataChannel('trinity', { ordered: true });
        this._setupDC(dc, peerId, state);
        state.dc = dc;
      }

      pc.addEventListener('datachannel', ev => {
        this._setupDC(ev.channel, peerId, state);
        state.dc = ev.channel;
      });

      pc.addEventListener('icecandidate', async ({ candidate }) => {
        if (!candidate) return;
        try { await this._post('/rtc/ice', { peerId: this.userId, candidate }); } catch {}
      });

      pc.addEventListener('connectionstatechange', () => {
        const s = pc.connectionState;
        this._dispatch({ nonce: nonce(), type: 'RTC_STATE', payload: { peerId, state: s }, ts: Date.now() });
        if (s === 'failed' || s === 'disconnected') {
          this._peers.delete(peerId);
          setTimeout(() => this.rtcConnect(peerId), 5_000);
        }
      });

      return state;
    }

    _setupDC(dc, peerId, state) {
      dc.addEventListener('message', ev => {
        try { this._dispatch(JSON.parse(ev.data)); } catch {}
      });
      dc.addEventListener('open', () => {
        console.log(`[Tunnel/RTC] P2P channel open → ${peerId}`);
        state.ready = true;
        this._drain();
        this._dispatch({ nonce: nonce(), type: 'RTC_OPEN', payload: { peerId }, ts: Date.now() });
      });
      dc.addEventListener('close', () => { state.ready = false; });
    }

    // Handle incoming signaling events from SSE
    _bindSignaling() {
      this.on('RTC_OFFER', async ({ peerId, offer }) => {
        if (peerId === this.userId || this._peers.has(peerId)) return;
        const state = this._makePeer(peerId, true);
        try {
          await state.pc.setRemoteDescription(offer);
          const answer = await state.pc.createAnswer();
          await state.pc.setLocalDescription(answer);
          await this._post('/rtc/answer', { peerId, answer });
        } catch {}
      });

      this.on('RTC_ANSWER', async ({ peerId, answer }) => {
        const s = this._peers.get(peerId);
        if (!s || s.polite) return;
        try { await s.pc.setRemoteDescription(answer); } catch {}
      });

      this.on('RTC_ICE', async ({ peerId, candidate }) => {
        const s = this._peers.get(peerId);
        if (!s) return;
        try { await s.pc.addIceCandidate(candidate); } catch {}
      });
    }

    // ── Helpers ────────────────────────────────────────────────────────────
    _post(path, body) {
      return fetch(this.api + path, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      });
    }

    // ── Status ─────────────────────────────────────────────────────────────
    status() {
      const rtcPeers = [...this._peers.entries()]
        .map(([id, s]) => ({ peerId: id, dcState: s.dc?.readyState, pcState: s.pc?.connectionState }));
      return {
        userId:    this.userId,
        sseLane:   this._sseReady ? 'connected' : 'disconnected',
        rtcPeers,
        queueSize: this._queue.length,
      };
    }
  }

  return TrinityTunnel;
});

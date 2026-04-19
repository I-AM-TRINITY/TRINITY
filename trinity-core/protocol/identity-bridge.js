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
 * I-AM TRINITY BRIDGE — iam-bridge.js  (v2)
 * Zero external dependencies. Pure browser APIs only.
 *
 * What's new in v2:
 *  ① Liker tokens — every reaction (❤️ 🔥 💯) mints CST on the local
 *     ledger AND posts to the server, which distributes to all peers.
 *  ② Web2 tunnel  — SSE EventSource keeps a persistent server connection.
 *     Receives LIKER_MINT, MESSAGE, EARNING, BET_RESOLVED events live.
 *  ③ Web3 tunnel  — WebRTC DataChannel mesh. Once two peers connect,
 *     messages flow P2P without touching the server at all.
 *     Both tunnels run simultaneously. Neither replaces the other.
 *  ④ Single shared identity across all surfaces (unchanged from v1).
 *  ⑤ BroadcastChannel still bridges across tabs (unchanged from v1).
 *
 * Load this script FIRST in every surface:
 *   <script src="iam-bridge.js"></script>
 *
 * Global API exposed on window.IAM:
 *   IAM.identity      — current shared identity
 *   IAM.emit(type, payload)   — send on trinity bus
 *   IAM.react(messageId, authorId, emoji) — mint liker tokens
 *   IAM.likerBalance(userId) — local ledger CST balance string
 *   IAM.likerLeaderboard()   — sorted array from local ledger
 *   IAM.rtc.connect(peerId)  — initiate WebRTC peer connection
 *   IAM.on(type, fn)  — subscribe to bus events
 */

(function () {
  'use strict';

  // ── CONFIG ───────────────────────────────────────────────────────────────
  const SHARED_ID_KEY   = 'iam_shared_identity';
  const TRINITY_CHANNEL = 'iam-trinity-bus';
  const API_BASE        = window.IAM_API || 'http://localhost:3000/api';

  // Liker token mint rates (micro-CST; 1 CST = 1_000_000 µCST)
  const EMOJI_MINT = { '❤️': 1_000_000, '🔥': 500_000, '💯': 250_000 };
  const DEFAULT_MINT = 100_000;

  // ── SURFACE DETECTION ────────────────────────────────────────────────────
  const surface = (function detectSurface() {
    const t = document.title || '';
    if (t.includes('v5.1') || t.includes('SYSTEM v5')) return 'ios-v51';
    if (t.includes('REALITY') || t.includes('Planespace'))  return 'reality';
    return 'ios';
  })();
  window.__IAM_SURFACE = surface;

  // ── SHARED IDENTITY ──────────────────────────────────────────────────────
  function loadSharedIdentity() {
    try { return JSON.parse(localStorage.getItem(SHARED_ID_KEY)) || null; } catch { return null; }
  }
  function saveSharedIdentity(id) {
    try { localStorage.setItem(SHARED_ID_KEY, JSON.stringify(id)); } catch {}
  }
  function migrateFromV51() {
    try {
      const raw = localStorage.getItem('iam_system_v51');
      if (!raw) return null;
      const d = JSON.parse(decodeURIComponent(escape(atob(raw))));
      return d?.identity?.id ? { id: d.identity.id, name: d.identity.name || '', keyHex: d.identity.keyHex || '', ts: Date.now() } : null;
    } catch { return null; }
  }
  function migrateFromReality() {
    try {
      const d = JSON.parse(localStorage.getItem('iam_reality_v1') || 'null');
      return d?.nodeId ? { id: d.nodeId, name: d.nodeName || '', keyHex: '', ts: Date.now() } : null;
    } catch { return null; }
  }
  function ensureSharedIdentity() {
    let id = loadSharedIdentity();
    if (id?.id) return id;
    id = migrateFromV51() || migrateFromReality();
    if (id?.id) { saveSharedIdentity(id); return id; }
    const arr = new Uint8Array(20);
    crypto.getRandomValues(arr);
    const hex = Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
    id = { id: hex, name: '', keyHex: hex, ts: Date.now() };
    saveSharedIdentity(id);
    return id;
  }

  const identity = ensureSharedIdentity();

  // ── EVENT BUS ─────────────────────────────────────────────────────────────
  const bus = new BroadcastChannel(TRINITY_CHANNEL);
  let legacyBus;
  try { legacyBus = new BroadcastChannel('sovereign-os-bus'); } catch {}

  const listeners = {};   // type → [fn, ...]

  function on(type, fn) {
    (listeners[type] = listeners[type] || []).push(fn);
    return () => { listeners[type] = (listeners[type] || []).filter(f => f !== fn); };
  }

  function dispatchLocal(type, payload) {
    (listeners[type] || []).forEach(fn => { try { fn(payload); } catch {} });
    (listeners['*']  || []).forEach(fn => { try { fn({ type, payload }); } catch {} });
  }

  function emit(type, payload) {
    const msg = { type, source: surface, payload, ts: Date.now() };
    bus.postMessage(msg);
    if (legacyBus) legacyBus.postMessage(msg);
    dispatchLocal(type, payload);
  }

  bus.addEventListener('message', ev => {
    if (!ev.data?.type) return;
    dispatchLocal(ev.data.type, ev.data.payload);
  });

  // ── LIKER TOKEN LEDGER (local mirror) ─────────────────────────────────────
  // Each entry: { id, fromUserId, toUserId, messageId, emoji, tokens, ts }
  const likerLedger   = JSON.parse(localStorage.getItem('iam_liker_ledger') || '[]');
  const tokenBalances = new Map();  // userId → Number (CST, decimal)

  // Replay ledger into balances
  likerLedger.forEach(e => {
    tokenBalances.set(e.toUserId, (tokenBalances.get(e.toUserId) || 0) + e.tokens / 1_000_000);
  });

  function saveLedger() {
    try { localStorage.setItem('iam_liker_ledger', JSON.stringify(likerLedger.slice(-500))); } catch {}
  }

  function applyMint(entry) {
    // Idempotent by entry.id
    if (likerLedger.find(e => e.id === entry.id)) return;
    likerLedger.push(entry);
    tokenBalances.set(entry.toUserId, (tokenBalances.get(entry.toUserId) || 0) + entry.tokens / 1_000_000);
    saveLedger();
    dispatchLocal('LIKER_MINT', entry);
  }

  function revertMint(entry) {
    const index = likerLedger.findIndex(e => e.id === entry.id);
    if (index === -1) return;
    likerLedger.splice(index, 1);
    tokenBalances.set(entry.toUserId, Math.max(0, (tokenBalances.get(entry.toUserId) || 0) - entry.tokens / 1_000_000));
    saveLedger();
  }

  function likerBalance(userId) {
    return (tokenBalances.get(userId) || 0).toFixed(6) + ' CST';
  }

  function likerLeaderboard() {
    return [...tokenBalances.entries()]
      .map(([userId, cst]) => ({ userId, cst }))
      .sort((a, b) => b.cst - a.cst);
  }

  async function postJson(path, payload) {
    if (window.TRINITY_AUTH?.postJson) {
      return window.TRINITY_AUTH.postJson(path, payload);
    }
    const response = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || `Request failed: ${response.status}`);
    }
    return response.json();
  }

  // ── REACT (mint tokens + post to server) ─────────────────────────────────
  async function react(messageId, authorId, emoji) {
    const tokens  = EMOJI_MINT[emoji] ?? DEFAULT_MINT;
    const entry   = {
      id:         crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2),
      fromUserId: identity.id,
      toUserId:   authorId,
      messageId,
      emoji,
      tokens,
      ts:         Date.now(),
    };

    // 1. Write to local ledger immediately (optimistic)
    applyMint(entry);

    // 2. Emit on bus (other tabs see it)
    emit('LIKER_MINT', entry);

    // 3. Post to server (best-effort; failure doesn't break UX)
    try {
      await postJson(`/messages/${messageId}/react`, { emoji, fromUserId: identity.id });
    } catch (error) {
      revertMint(entry);
      throw error;
    }

    return entry;
  }

  // ── WEB2 TUNNEL — SSE ─────────────────────────────────────────────────────
  const web2 = (function initSSE() {
    let es, reconnectTimer;

    function connect() {
      if (es) es.close();
      es = new EventSource(`${API_BASE}/stream?userId=${encodeURIComponent(identity.id)}`);

      es.addEventListener('message', ev => {
        try {
          const { type, payload } = JSON.parse(ev.data);
          if (type === 'LIKER_MINT') applyMint(payload);
          dispatchLocal(type, payload);
        } catch {}
      });

      es.addEventListener('open', () => {
        console.log('[IAM] Web2 SSE connected');
        clearTimeout(reconnectTimer);
      });

      es.addEventListener('error', () => {
        es.close();
        reconnectTimer = setTimeout(connect, 5_000);
      });
    }

    // Only connect if EventSource available (not available in all contexts)
    if (typeof EventSource !== 'undefined') connect();

    return {
      get readyState() { return es?.readyState ?? -1; },
      reconnect: connect,
    };
  })();

  // ── WEB3 TUNNEL — WebRTC mesh ─────────────────────────────────────────────
  // Peers negotiate via the server's /api/rtc/* signaling endpoints.
  // Once RTCDataChannel is open, messages flow directly P2P.
  const web3 = (function initRTC() {
    if (typeof RTCPeerConnection === 'undefined') return { peers: new Map() };

    const peers = new Map();   // peerId → { pc, dc, state }
    const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

    async function createConnection(peerId, polite) {
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      const state = { pc, dc: null, polite };
      peers.set(peerId, state);

      // Data channel (offerer creates it)
      if (!polite) {
        const dc = pc.createDataChannel('iam-trinity', { ordered: true });
        setupDataChannel(dc, peerId);
        state.dc = dc;
      }

      pc.addEventListener('datachannel', ev => {
        setupDataChannel(ev.channel, peerId);
        state.dc = ev.channel;
      });

      // ICE candidate relay via server
      pc.addEventListener('icecandidate', async ({ candidate }) => {
        if (!candidate) return;
        try {
          await fetch(`${API_BASE}/rtc/ice`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ peerId: identity.id, candidate }),
          });
        } catch {}
      });

      pc.addEventListener('connectionstatechange', () => {
        const s = pc.connectionState;
        dispatchLocal('RTC_STATE', { peerId, state: s });
        if (s === 'failed' || s === 'disconnected') {
          setTimeout(() => connect(peerId), 5_000);
        }
      });

      return state;
    }

    function setupDataChannel(dc, peerId) {
      dc.addEventListener('message', ev => {
        try {
          const { type, payload } = JSON.parse(ev.data);
          if (type === 'LIKER_MINT') applyMint(payload);
          dispatchLocal(type, payload);
        } catch {}
      });
      dc.addEventListener('open', () => {
        console.log(`[IAM] Web3 P2P channel open → ${peerId}`);
        dispatchLocal('RTC_OPEN', { peerId });
      });
    }

    // Broadcast over all open data channels
    function broadcastRTC(type, payload) {
      const msg = JSON.stringify({ type, payload });
      for (const [, s] of peers) {
        if (s.dc?.readyState === 'open') {
          try { s.dc.send(msg); } catch {}
        }
      }
    }

    // Offerer flow
    async function connect(peerId) {
      const state = await createConnection(peerId, false);
      try {
        const offer = await state.pc.createOffer();
        await state.pc.setLocalDescription(offer);
        await fetch(`${API_BASE}/rtc/offer`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ peerId: identity.id, offer }),
        });
      } catch {}
    }

    // Listen for incoming offers/answers via SSE
    on('RTC_OFFER', async ({ peerId, offer }) => {
      if (peerId === identity.id || peers.has(peerId)) return;
      const state = await createConnection(peerId, true);
      try {
        await state.pc.setRemoteDescription(offer);
        const answer = await state.pc.createAnswer();
        await state.pc.setLocalDescription(answer);
        await fetch(`${API_BASE}/rtc/answer`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ peerId, answer }),
        });
      } catch {}
    });

    on('RTC_ANSWER', async ({ peerId, answer }) => {
      const state = peers.get(peerId);
      if (!state || state.polite) return;
      try { await state.pc.setRemoteDescription(answer); } catch {}
    });

    on('RTC_ICE', async ({ peerId, candidate }) => {
      const state = peers.get(peerId);
      if (!state) return;
      try { await state.pc.addIceCandidate(candidate); } catch {}
    });

    // Forward LIKER_MINT events from bus to all P2P peers
    on('LIKER_MINT', entry => broadcastRTC('LIKER_MINT', entry));

    return { peers, connect, broadcastRTC };
  })();

  // ── SURFACE PATCHING (unchanged from v1) ─────────────────────────────────
  function patchV51(id) {
    const tick = setInterval(() => {
      if (typeof S === 'undefined') return;
      clearInterval(tick);
      if (id.id) { S.identity.id = id.id; S.identity.keyHex = id.keyHex || id.id; if (id.name) S.identity.name = id.name; }
      const origGen  = window.generateKeypair;
      const origSave = window.saveState;
      if (origGen)  window.generateKeypair = async function() { await origGen(); saveSharedIdentity({ id: S.identity.id, name: S.identity.name, keyHex: S.identity.keyHex, ts: Date.now() }); };
      if (origSave) window.saveState = async function() { await origSave(); saveSharedIdentity({ id: S.identity.id, name: S.identity.name, keyHex: S.identity.keyHex, ts: Date.now() }); };
      const ni = document.getElementById('id-name');
      if (ni) ni.addEventListener('change', () => { S.identity.name = ni.value; saveSharedIdentity({ id: S.identity.id, name: S.identity.name, keyHex: S.identity.keyHex, ts: Date.now() }); });
    }, 50);
  }

  function patchReality(id) {
    const tick = setInterval(() => {
      const raw = localStorage.getItem('iam_reality_v1');
      if (!raw) return;
      clearInterval(tick);
      try {
        const d = JSON.parse(raw);
        if (!d.nodeId && id.id) { d.nodeId = id.id; d.nodeName = id.name || d.nodeName || ''; localStorage.setItem('iam_reality_v1', JSON.stringify(d)); }
      } catch {}
    }, 50);
  }

  if (surface === 'ios-v51') patchV51(identity);
  if (surface === 'reality') patchReality(identity);

  // ── PUBLIC API ────────────────────────────────────────────────────────────
  window.IAM = {
    identity,
    surface,
    emit,
    on,
    react,
    likerBalance,
    likerLeaderboard,
    likerLedger,
    web2,
    web3,
  };

  console.log(`[IAM] bridge v2 ready · surface=${surface} · id=${identity.id.slice(0, 8)}…`);
  emit('HEARTBEAT', { surface, ts: Date.now() });

})();

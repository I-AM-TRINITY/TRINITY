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
 * TRINITY IDENTITY — primitives/identity.js
 * ───────────────────────────────────────────────────────────────────────────
 * Pure identity model. Environment-agnostic. No network, no storage, no UI.
 *
 * Depends on: crypto/wallet.js (for signing)
 * Used by:    protocol/identity-bridge.js (for cross-surface sync)
 *             trinity.js (boot)
 *
 * An identity is:
 *   { id, name, keyHex, ts }
 *
 * The id IS the Ethereum address derived from the keypair.
 * No external auth. No MetaMask. Self-sovereign.
 */

'use strict';

const STORAGE_KEY = 'trinity_identity_v1';

// ── Pure functions ────────────────────────────────────────────────────────

/** Create a new random identity (requires crypto/wallet.js loaded) */
function createIdentity(name = '') {
  if (typeof TrinityWallet === 'undefined') {
    // Fallback: random hex id without signing capability
    const arr = new Uint8Array(20);
    crypto.getRandomValues(arr);
    const id = '0x' + Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
    return { id, name, keyHex: '', ts: Date.now(), canSign: false };
  }
  const kp = TrinityWallet.generateKeypairSync?.() || TrinityWallet.generateWalletSync?.();
  return { id: kp.address, name, keyHex: kp.privateKey || kp.keyHex || '', ts: Date.now(), canSign: true };
}

/** Restore identity from storage */
function loadIdentity() {
  try {
    // Try canonical key first
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);

    // Legacy migration: iam-trinity-wired format
    const legacy = localStorage.getItem('iam_shared_identity');
    if (legacy) {
      const id = JSON.parse(legacy);
      saveIdentity(id);
      return id;
    }

    // Legacy migration: v51 base64 format
    const v51 = localStorage.getItem('iam_system_v51');
    if (v51) {
      const d = JSON.parse(decodeURIComponent(escape(atob(v51))));
      if (d?.identity?.id) {
        const id = { id: d.identity.id, name: d.identity.name || '', keyHex: d.identity.keyHex || '', ts: Date.now(), canSign: !!d.identity.keyHex };
        saveIdentity(id);
        return id;
      }
    }
  } catch {}
  return null;
}

/** Persist identity to storage */
function saveIdentity(identity) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(identity)); } catch {}
}

/** Load or create — always returns a valid identity */
function ensureIdentity(name = '') {
  return loadIdentity() || (() => {
    const id = createIdentity(name);
    saveIdentity(id);
    return id;
  })();
}

/** Sign a message with this identity's key */
async function sign(identity, message) {
  if (!identity.keyHex || typeof TrinityWallet === 'undefined') return null;
  try {
    return await TrinityWallet.sign(message, identity.keyHex);
  } catch { return null; }
}

/** Verify a signature against an address */
async function verify(message, signature, expectedAddress) {
  if (typeof TrinityWallet === 'undefined') return false;
  try {
    const recovered = TrinityWallet.recoverAddress(message, signature);
    return recovered?.toLowerCase() === expectedAddress?.toLowerCase();
  } catch { return false; }
}

// ── Export ────────────────────────────────────────────────────────────────
const TrinityIdentity = { createIdentity, loadIdentity, saveIdentity, ensureIdentity, sign, verify };

if (typeof module !== 'undefined' && module.exports) module.exports = TrinityIdentity;
else if (typeof window !== 'undefined') window.TrinityIdentity = TrinityIdentity;

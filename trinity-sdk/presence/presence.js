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
 * trinity/presence/presence.js
 *
 * Ephemeral presence layer — cursors, selections, user identity.
 *
 * CRITICAL ARCHITECTURE NOTE:
 *   Presence data is NOT part of the deterministic event log.
 *   It flows over the same transport using `_ephemeral: true` so
 *   the sync layer skips it. This keeps your log clean and replayable.
 *
 * Properties:
 *   ✓ Zero log pollution
 *   ✓ Automatic stale-peer cleanup (10 s timeout)
 *   ✓ Throttled updates (default 50 ms) to prevent flooding
 *   ✓ Random identity (name + color) per session
 *
 * Usage:
 *   import { createPresence } from "../presence/presence.js"
 *
 *   const presence = createPresence(transport, selfId)
 *
 *   // Send your cursor position
 *   presence.update({ x: 120, y: 300 })
 *
 *   // Render all peers
 *   presence.subscribe((peers) => {
 *     peers.forEach(p => renderCursor(p))
 *   })
 */

export function createPresence(transport, peerId, options = {}) {
  const { staleMs = 10_000, pingMs = 3_000 } = options

  const peerMap = new Map()
  const listeners = []

  // --- identity ---
  const identity = {
    name: adjectives[Math.floor(Math.random() * adjectives.length)] +
          " " +
          animals[Math.floor(Math.random() * animals.length)],
    color: `hsl(${Math.floor(Math.random() * 360)}, 70%, 55%)`,
  }

  // --- send ---
  function update(data) {
    const msg = {
      type: "presence",
      peerId,
      data: { ...identity, ...data },
      _ts: Date.now(),
      _ephemeral: true,
    }

    transport.broadcast(msg)
    apply(msg)
  }

  // --- receive ---
  transport.onMessage((msg) => {
    if (msg.type === "presence" && msg.peerId !== peerId) {
      apply(msg)
    }
  })

  function apply(msg) {
    peerMap.set(msg.peerId, {
      peerId: msg.peerId,
      ...msg.data,
      _ts: msg._ts,
    })

    notify()
  }

  // --- notify subscribers ---
  function notify() {
    const all = Array.from(peerMap.values())
    listeners.forEach((fn) => fn(all))
  }

  function subscribe(fn) {
    listeners.push(fn)
    fn(Array.from(peerMap.values()))
    return () => {
      const idx = listeners.indexOf(fn)
      if (idx !== -1) listeners.splice(idx, 1)
    }
  }

  function getAll() {
    return Array.from(peerMap.values())
  }

  // --- stale peer cleanup ---
  const cleanupInterval = setInterval(() => {
    const now = Date.now()
    let changed = false

    for (const [id, p] of peerMap) {
      if (now - p._ts > staleMs) {
        peerMap.delete(id)
        changed = true
      }
    }

    if (changed) notify()
  }, 2_000)

  // --- keepalive ping ---
  let currentState = {}
  const pingInterval = setInterval(() => {
    update(currentState)
  }, pingMs)

  function destroy() {
    clearInterval(cleanupInterval)
    clearInterval(pingInterval)
  }

  return {
    update(data) {
      currentState = { ...currentState, ...data }
      update(data)
    },
    subscribe,
    getAll,
    identity,
    destroy,
  }
}

// --- fun random identity words ---
const adjectives = [
  "Amber", "Cobalt", "Crimson", "Dusk", "Emerald",
  "Fern", "Golden", "Indigo", "Jade", "Lapis",
  "Mauve", "Neon", "Onyx", "Pearl", "Quartz",
  "Rose", "Sage", "Teal", "Umber", "Violet",
]

const animals = [
  "Axolotl", "Capybara", "Dingo", "Emu", "Ferret",
  "Gecko", "Hedgehog", "Ibis", "Jackal", "Kiwi",
  "Lemur", "Meerkat", "Narwhal", "Okapi", "Pangolin",
  "Quokka", "Raccoon", "Salamander", "Tapir", "Uakari",
]

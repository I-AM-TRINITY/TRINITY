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
 * trinity/core/sync.js
 *
 * Attaches a transport to an app instance.
 * After calling attachSync, every local emit is broadcast
 * and every incoming broadcast is applied locally.
 *
 * The transport is responsible for:
 *  - deduplication (via _id)
 *  - delivery (P2P, WS, local, etc.)
 *
 * This layer stays intentionally thin.
 */

export function attachSync(app, transport) {
  // Keep a reference to the raw (unpatched) emit BEFORE we wrap it.
  // This is the only place in the system that calls originalEmit directly.
  const originalEmit = app.emit

  // Incoming events from other peers → apply to local state only.
  // We deliberately call originalEmit (not app.emit) here so that
  // incoming events do NOT get re-broadcast by this peer.
  // The WebRTC gossip layer handles propagation to other peers itself.
  transport.onMessage((event) => {
    // Ephemeral messages (presence) must never enter the deterministic log.
    if (event._ephemeral) return

    originalEmit(event)
  })

  // Patch app.emit so that locally-originated events are broadcast.
  // Remote events arrive via onMessage → originalEmit, bypassing this.
  app.emit = (event) => {
    originalEmit(event)

    // Read the stamped event from the log tail (originalEmit added _id/_ts).
    const stamped = app.log[app.log.length - 1]
    transport.broadcast(stamped)
  }

  return app
}

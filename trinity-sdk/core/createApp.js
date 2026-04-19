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
 * trinity/core/createApp.js
 *
 * The non-negotiable core of the Trinity SDK.
 *
 * Mental model:
 *   EVENT → LOG → REDUCE → STATE
 *
 * Rules (never break these):
 *  1. reduce() is a pure function — no side effects
 *  2. The log is append-only — never mutate history
 *  3. State is always reconstructible by replaying the log
 */

export function createApp({ init, reduce }) {
  let state = init
  const listeners = []
  const log = []

  /**
   * Emit an event into the system.
   * This is the ONLY way to change state.
   *
   * @param {object} event - Must have a `type` field.
   */
  function emit(event) {
    // Stamp every event with a sequence number and wall-clock time
    // so logs from multiple peers can be reasoned about.
    const stamped = {
      ...event,
      _seq: log.length,
      _ts: event._ts ?? Date.now(),
      _id: event._id ?? crypto.randomUUID(),
    }

    log.push(stamped)
    state = reduce(state, stamped)

    listeners.forEach((l) => l(state, stamped))
  }

  /**
   * Subscribe to state changes.
   *
   * @param {function} fn - Called with (state, event) on every emit.
   * @returns {function} unsubscribe
   */
  function subscribe(fn) {
    listeners.push(fn)
    return () => {
      const idx = listeners.indexOf(fn)
      if (idx !== -1) listeners.splice(idx, 1)
    }
  }

  function getState() {
    return state
  }

  /**
   * Replay a foreign log into this app (used for sync).
   * Skips events already in the log by _id.
   */
  function replay(events) {
    const seen = new Set(log.map((e) => e._id))
    events
      .filter((e) => !seen.has(e._id))
      .forEach((e) => emit(e))
  }

  return {
    emit,
    subscribe,
    getState,
    replay,
    get log() {
      return log
    },
  }
}

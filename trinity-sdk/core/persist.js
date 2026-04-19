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
 * trinity/core/persist.js
 *
 * Local persistence via localStorage.
 * Replays the saved event log on startup, then keeps it up to date.
 *
 * Because state is always reconstructible from the log, we only
 * need to persist the log — not the state itself.
 *
 * Usage:
 *   import { persist } from "../core/persist.js"
 *   persist(app, "my-app-log")
 */

export function persist(app, key = "trinity-log") {
  // Replay any saved events from a previous session
  try {
    const saved = JSON.parse(localStorage.getItem(key) || "[]")
    if (saved.length > 0) {
      app.replay(saved)
    }
  } catch (e) {
    console.warn("[trinity/persist] Could not load saved log:", e)
  }

  // Save the log whenever state changes
  app.subscribe(() => {
    try {
      localStorage.setItem(key, JSON.stringify(app.log))
    } catch (e) {
      console.warn("[trinity/persist] Could not save log:", e)
    }
  })
}

/**
 * Clear the persisted log for a given key.
 */
export function clearPersisted(key = "trinity-log") {
  localStorage.removeItem(key)
}

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
 * trinity/transport/local.js
 *
 * A no-op transport that keeps all events local.
 * Perfect for offline apps or unit testing.
 *
 * Usage:
 *   import { localTransport } from "../transport/local.js"
 *   attachSync(app, localTransport)
 */

export const localTransport = {
  onMessage: (_fn) => {
    // Nothing arrives from outside — we are the only peer.
  },
  broadcast: (_event) => {
    // Nothing to broadcast — we are the only peer.
  },
}

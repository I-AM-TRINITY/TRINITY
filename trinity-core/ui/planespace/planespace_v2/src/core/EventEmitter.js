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
 * EventEmitter — lightweight typed event bus for planespace.
 *
 * Used internally. Exposed as a public export so integrators
 * can use it in their own wrappers.
 */
export class EventEmitter {
  #listeners = new Map();

  /**
   * Subscribe to an event.
   * @returns {Function} Unsubscribe function.
   */
  on(event, handler) {
    if (!this.#listeners.has(event)) {
      this.#listeners.set(event, new Set());
    }
    this.#listeners.get(event).add(handler);
    return () => this.off(event, handler);
  }

  off(event, handler) {
    const handlers = this.#listeners.get(event);
    if (handlers) handlers.delete(handler);
  }

  emit(event, data) {
    const handlers = this.#listeners.get(event);
    if (!handlers) return;
    for (const handler of handlers) {
      try {
        handler(data);
      } catch (err) {
        console.error(`[planespace] Uncaught error in "${event}" event handler:`, err);
      }
    }
  }

  removeAllListeners(event) {
    if (event) {
      this.#listeners.delete(event);
    } else {
      this.#listeners.clear();
    }
  }

  /** Number of listeners registered across all events. */
  get listenerCount() {
    let n = 0;
    for (const s of this.#listeners.values()) n += s.size;
    return n;
  }
}

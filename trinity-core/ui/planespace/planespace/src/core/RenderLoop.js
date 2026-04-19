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
 * RenderLoop — requestAnimationFrame-based render loop with frame scheduling
 */
export class RenderLoop {
  constructor(options = {}) {
    this.targetFPS = options.targetFPS || 60;
    this._onFrame = options.onFrame || (() => {});
    this._rafId = null;
    this._running = false;
    this._lastTime = 0;
    this._frameInterval = 1000 / this.targetFPS;
  }

  start() {
    if (this._running) return;
    this._running = true;
    this._lastTime = 0;
    this._schedule();
  }

  stop() {
    this._running = false;
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }

  _schedule() {
    this._rafId = requestAnimationFrame((timestamp) => {
      if (!this._running) return;

      const elapsed = timestamp - this._lastTime;

      if (elapsed >= this._frameInterval) {
        this._lastTime = timestamp - (elapsed % this._frameInterval);
        this._onFrame(timestamp);
      }

      this._schedule();
    });
  }

  setTargetFPS(fps) {
    this.targetFPS = fps;
    this._frameInterval = 1000 / fps;
  }
}

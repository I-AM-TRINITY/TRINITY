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
 * MouseInput — maps mouse position to normalized viewer angle
 */
export class MouseInput {
  constructor(options = {}) {
    this.maxAngle = options.maxAngle || 6;
    this.deadzone = options.inputDeadzone || 0.03;
    this._targetX = 0;
    this._targetY = 0;
    this._handler = this._onMouseMove.bind(this);
  }

  attach() {
    window.addEventListener('mousemove', this._handler, { passive: true });
  }

  detach() {
    window.removeEventListener('mousemove', this._handler);
  }

  _onMouseMove(e) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    // Normalize to -1..1, center = 0
    let nx = (e.clientX / w) * 2 - 1;
    let ny = (e.clientY / h) * 2 - 1;

    // Apply deadzone
    if (Math.abs(nx) < this.deadzone) nx = 0;
    if (Math.abs(ny) < this.deadzone) ny = 0;

    this._targetX = nx;
    this._targetY = ny;
  }

  /**
   * Returns target viewer offset as { x, y } in -1..1 range
   */
  getTarget() {
    return { x: this._targetX, y: this._targetY };
  }
}

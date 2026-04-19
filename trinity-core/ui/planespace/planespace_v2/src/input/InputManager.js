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

import { MouseInput } from './MouseInput.js';
import { GyroInput } from './GyroInput.js';

/**
 * InputManager — selects the right input strategy and smooths the viewer angle.
 *
 * Supports mouse, gyroscope, both (auto-selected by device), or external override.
 */
export class InputManager {
  constructor(options = {}) {
    this.inputMode = options.inputMode || 'mouse';
    this.lerpFactor = options.lerpFactor !== undefined ? options.lerpFactor : 0.06;
    this.options = options;

    this._viewerX = 0;
    this._viewerY = 0;
    this._externalX = 0;
    this._externalY = 0;
    this._externalOverride = false;

    this._drivers = [];
    this._attached = false;
    this._setupDrivers();
  }

  _isMobile() {
    return typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0;
  }

  _setupDrivers() {
    const mode = this.inputMode;
    const isMobile = this._isMobile();

    if (mode === 'mouse' || (mode === 'both' && !isMobile)) {
      this._drivers.push(new MouseInput(this.options));
    }
    if (mode === 'gyro' || (mode === 'both' && isMobile)) {
      this._drivers.push(new GyroInput(this.options));
    }
    // 'none' — no drivers
  }

  attach() {
    if (this._attached) return;
    for (const d of this._drivers) d.attach();
    this._attached = true;
  }

  detach() {
    if (!this._attached) return;
    for (const d of this._drivers) d.detach();
    this._attached = false;
  }

  /**
   * Update live configuration (maxAngle, lerpFactor, etc.)
   */
  configure(options) {
    if (options.lerpFactor !== undefined) this.lerpFactor = options.lerpFactor;
    for (const d of this._drivers) {
      if (options.maxAngle !== undefined) d.maxAngle = options.maxAngle;
    }
  }

  /**
   * Manually set viewer position (external/programmatic mode).
   * When called, overrides driver input until clearViewer() is called.
   */
  setViewer(x, y) {
    this._externalX = Math.max(-1, Math.min(1, x));
    this._externalY = Math.max(-1, Math.min(1, y));
    this._externalOverride = true;
  }

  /**
   * Clear manual viewer override and resume driver input.
   */
  clearViewer() {
    this._externalOverride = false;
  }

  /**
   * Tick: lerp toward target. Call once per frame.
   * @returns {{ x: number, y: number }} Current smoothed viewer position.
   */
  tick() {
    let targetX, targetY;

    if (this._externalOverride) {
      targetX = this._externalX;
      targetY = this._externalY;
    } else if (this._drivers.length > 0) {
      let sumX = 0, sumY = 0;
      for (const d of this._drivers) {
        const t = d.getTarget();
        sumX += t.x;
        sumY += t.y;
      }
      targetX = sumX / this._drivers.length;
      targetY = sumY / this._drivers.length;
    } else {
      targetX = 0;
      targetY = 0;
    }

    // Frame-rate independent lerp
    const alpha = this.lerpFactor;
    this._viewerX += (targetX - this._viewerX) * alpha;
    this._viewerY += (targetY - this._viewerY) * alpha;

    return { x: this._viewerX, y: this._viewerY };
  }

  /** Current smoothed viewer position. */
  get current() {
    return { x: this._viewerX, y: this._viewerY };
  }
}

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
 * Html2canvas — fallback capture strategy using html2canvas library
 * Used when captureStream is not available.
 */
export class Html2canvasCapture {
  constructor(options = {}) {
    this.resolution = options.captureResolution || 1.0;
    this._h2c = null;
    this._canvas = null;
  }

  async init() {
    // Attempt to load html2canvas dynamically if not available
    if (typeof html2canvas === 'undefined') {
      if (typeof window !== 'undefined' && window.html2canvas) {
        this._h2c = window.html2canvas;
      } else {
        // Try dynamic import as last resort
        try {
          const mod = await import('html2canvas');
          this._h2c = mod.default || mod;
        } catch {
          throw new Error('[planespace] html2canvas not available');
        }
      }
    } else {
      this._h2c = html2canvas;
    }
  }

  /**
   * Capture the given root element.
   * Returns ImageBitmap.
   */
  async capture(root = document.body) {
    if (!this._h2c) return null;

    const scale = this.resolution;
    const canvas = await this._h2c(root, {
      scale,
      useCORS: true,
      allowTaint: false,
      logging: false,
      backgroundColor: null,
    });

    return await createImageBitmap(canvas);
  }

  destroy() {
    this._h2c = null;
  }
}

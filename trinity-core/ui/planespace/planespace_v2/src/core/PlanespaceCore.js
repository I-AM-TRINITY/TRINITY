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

import { DepthRegistry } from './DepthRegistry.js';
import { WarpShader } from '../shader/WarpShader.js';

/**
 * PlanespaceCore — low-level render interface for custom runtimes
 * (Servo, Ladybird, embedded WebView, etc.)
 *
 * You provide the frame capture and output callback;
 * PlanespaceCore handles the depth warp.
 */
export class PlanespaceCore {
  constructor(options = {}) {
    this.captureFrame = options.captureFrame;
    this.getDepthMap = options.getDepthMap;
    this.outputCallback = options.outputCallback;

    this._canvas = document.createElement('canvas');
    this._canvas.width = window.innerWidth;
    this._canvas.height = window.innerHeight;

    this._shader = new WarpShader(this._canvas, options);
    this._shader.init();

    if (this.outputCallback) {
      this.outputCallback(this._canvas);
    }
  }

  /**
   * Render one frame with the given viewer angle.
   */
  async renderFrame(viewerX, viewerY) {
    if (this.captureFrame) {
      const frame = await this.captureFrame();
      if (frame) {
        // Convert Uint8ClampedArray to ImageData then upload
        const imageData = new ImageData(frame.pixels, frame.width, frame.height);
        const bmp = await createImageBitmap(imageData);
        this._shader.uploadScene(bmp);
      }
    }

    if (this.getDepthMap) {
      const depthMap = this.getDepthMap();
      if (depthMap) {
        this._shader.uploadDepth(depthMap);
      }
    }

    this._shader.render(viewerX, viewerY);
  }

  destroy() {
    this._shader.destroy();
  }
}

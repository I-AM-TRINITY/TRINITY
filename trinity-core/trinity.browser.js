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

'use strict';

(function (root) {
  let loadPromise = null;

  async function ensureCompatibilityEntry() {
    if (root.Trinity?.boot && root.Trinity !== api) return root.Trinity;
    if (loadPromise) return loadPromise;

    if (typeof document === 'undefined' || !document.currentScript?.src) {
      throw new Error('[TRINITY] trinity.browser.js could not locate trinity.js automatically.');
    }

    const src = new URL('./trinity.js', document.currentScript.src).toString();
    loadPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = () => {
        if (root.Trinity?.boot) resolve(root.Trinity);
        else reject(new Error('[TRINITY] compatibility entrypoint loaded without boot().'));
      };
      script.onerror = () => reject(new Error(`[TRINITY] failed to load ${src}`));
      document.head.appendChild(script);
    });

    return loadPromise;
  }

  async function boot(opts = {}) {
    const compatibility = await ensureCompatibilityEntry();
    return compatibility.boot(opts);
  }

  const api = { boot };
  root.TrinityBrowser = api;
  if (!root.Trinity) root.Trinity = api;
}(typeof globalThis !== 'undefined' ? globalThis : this));

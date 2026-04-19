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
 * DevTools — development-mode validation and warnings.
 *
 * In production builds these are tree-shaken to no-ops.
 */

const IS_DEV = typeof process !== 'undefined'
  ? process.env.NODE_ENV !== 'production'
  : !('__PS_PROD__' in globalThis);

/**
 * Emit a development-mode warning.
 * Silenced in production builds.
 *
 * @param {string} message
 */
export function warn(message) {
  if (IS_DEV) {
    console.warn(`[planespace] ${message}`);
  }
}

/**
 * Assert a condition and throw a descriptive error if it fails.
 * In production, throws a terse error without the full message.
 *
 * @param {boolean} condition
 * @param {string} message
 * @throws {Error}
 */
export function validate(condition, message) {
  if (!condition) {
    throw new Error(IS_DEV
      ? `[planespace] Configuration error: ${message}`
      : `[planespace] Invalid configuration.`
    );
  }
}

/**
 * Assert a condition for internal invariants.
 * Always throws in both dev and production.
 *
 * @param {boolean} condition
 * @param {string} message
 */
export function invariant(condition, message) {
  if (!condition) {
    throw new Error(`[planespace] Internal error: ${message}. ` +
      'This is a bug — please report it at https://github.com/planespace/planespace/issues');
  }
}

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
 * planespace — DOM-native perceptual compositor.
 *
 * @see https://github.com/planespace/planespace
 * @license AGPL-3.0-or-later
 */

export { Planespace } from './core/Planespace.js';
export { PlanespaceCore } from './core/PlanespaceCore.js';
export { DepthRegistry } from './core/DepthRegistry.js';
export { EventEmitter } from './core/EventEmitter.js';
export { SpatialLayout } from './layout/SpatialLayout.js';
export { WarpShader } from './shader/WarpShader.js';

export const VERSION = '1.0.0';

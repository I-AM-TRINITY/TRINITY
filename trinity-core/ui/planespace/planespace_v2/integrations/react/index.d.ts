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

import type { ReactNode, CSSProperties, RefObject } from 'react';
import type { Planespace, PlanespaceOptions, FrameEvent } from '../../types/index.js';

export interface UsePlanespaceReturn {
  /** Attach to the root element: <section ref={ref}> */
  ref: RefObject<HTMLElement>;
  /** Planespace instance, or null before mount. */
  ps: Planespace | null;
  /** Current smoothed viewer position (-1..1). */
  viewer: { x: number; y: number };
  /** Whether planespace is mounted and active. */
  mounted: boolean;
  /** Total frames rendered. */
  frameCount: number;
  pause: () => void;
  resume: () => void;
  setViewer: (x: number, y: number) => void;
}

/**
 * React hook for managing the planespace lifecycle.
 *
 * @example
 *   const { ref, viewer } = usePlanespace({ maxAngle: 8 });
 *   return <section ref={ref}><h1 data-z="60">Title</h1></section>;
 */
export declare function usePlanespace(options?: PlanespaceOptions): UsePlanespaceReturn;

export interface PlanespaceSceneProps extends PlanespaceOptions {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  onReady?: () => void;
  onFrame?: (e: FrameEvent) => void;
}

/**
 * Drop-in component wrapper.
 *
 * @example
 *   <PlanespaceScene maxAngle={8}>
 *     <h1 data-z="60">Title</h1>
 *   </PlanespaceScene>
 */
export declare function PlanespaceScene(props: PlanespaceSceneProps): JSX.Element;

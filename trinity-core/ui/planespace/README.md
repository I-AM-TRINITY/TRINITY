<!--
Trinity SDK / Planespace / Trinity Core
Copyright (c) 2026 James Chapman (XheCarpenXer)

Author: James Chapman
Alias: XheCarpenXer
Contact: xhecarpenxer@gmail.com

SPDX-License-Identifier: AGPL-3.0-or-later

This software is dual-licensed:
1. Open Source License: GNU Affero General Public License v3.0 or later (AGPLv3+).
2. Commercial / Government License: available for private, closed-source, warranty-backed,
   or separately negotiated terms beyond AGPL compliance.

See: LICENSE, COMMERCIAL-LICENSE.md, FEE-SCHEDULE.md, CLA.md, LEGAL-NOTES.md
THIS SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.
-->

# Planespace Workspace Notes

This directory currently contains multiple generations of the Planespace codebase.

## Current Layout

- `planespace/` is the package-oriented source tree
- `planespace_v2/` is the newer expanded package tree with docs and integrations
- `cli-planespace/` contains CLI tooling
- `js/` and `dist/` are legacy flattened outputs
- `planespace_game/` is an app/demo surface

## Consolidation Direction

The intended long-term structure is:

```text
planespace/
  core/
  ui/
  cli/
```

Recommended cleanup path:

1. Treat `planespace_v2/` as the canonical source for package evolution.
2. Keep `planespace/` and `js/` as legacy compatibility surfaces only until consumers are migrated.
3. Rebuild `dist/` from the canonical source instead of editing generated output by hand.
4. Collapse duplicate docs, typings, and examples once package consumers are pinned to a single tree.

## Maintainer Notes

- Prefer updating source trees over generated `dist/` files when possible.
- Keep license metadata and headers aligned across both source generations until the flattening work is complete.
- See the repo root `README.md` for the broader production roadmap.

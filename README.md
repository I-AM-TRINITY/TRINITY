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

# Trinity

Trinity is a sovereign execution and communication layer built from two primary surfaces:

- `trinity-sdk/` for deterministic event-log applications, sync transports, CRDT editing, presence, and AI workflows
- `trinity-core/` for the broader sovereign runtime, protocol, policy, and Planespace UI stack

## Licensing

This repository uses a dual-license model:

- Open-source use is available under `AGPL-3.0-or-later`
- A separate commercial/government license is available for teams that need private deployment, closed-source distribution, warranty terms, or operational terms beyond AGPL

See:

- `LICENSE`
- `COMMERCIAL-LICENSE.md`
- `FEE-SCHEDULE.md`
- `CLA.md`
- `LEGAL-NOTES.md`

## Production Gaps (Honest Status)

The SDK and runtime are ambitious and already useful, but some areas still need hardening before broad production rollout.

Recently addressed in this package:

- TURN/STUN auto-discovery and pluggable ICE server support for WebRTC
- DataChannel backpressure handling with bounded peer queues and resync fallbacks
- CRDT tombstone pruning, snapshot compaction hooks, and version-window garbage collection
- Token-authenticated signaling and room admission checks
- Explicit browser/node Trinity entrypoints to reduce compatibility shim sprawl

Still open or partially open:

- Signed signaling and stronger identity assertions still need a first-class protocol
- Large event logs still benefit from IndexedDB-backed persistence and more aggressive checkpointing
- Planespace still contains legacy duplicated package trees that should be flattened in a future cleanup
- Some legacy/generated artifacts may still need a rebuild to fully reflect the new headers and license metadata

## Roadmap

- Signed signaling plus durable identity proofs
- IndexedDB-backed event storage and replay checkpoints
- CRDT pruning policies tuned for long-lived shared documents
- Unified runtime adapters with fewer compatibility shims
- Planespace flattening toward `core`, `ui`, and `cli` targets

## Repo Notes

- Use the header tool in `tools/apply-legal-headers.mjs` to keep headers consistent
- See `trinity-core/ui/planespace/README.md` for the current consolidation plan
- See `trinity-sdk/README.md` and `trinity-core/README.md` for subsystem-specific usage

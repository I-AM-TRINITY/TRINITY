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

# TRINITY
## Sovereign compute network — v3.0

One system. Clean boundaries. No siblings.

---

## Architecture

```
trinity.js          composition root — assembly only, zero logic
│
├── crypto/         cryptographic primitives (no deps)
│   └── wallet.js   Keccak-256, secp256k1, EIP-191, AES-GCM
│
├── primitives/     deterministic core (depends: crypto only)
│   ├── sovereign-log.js     truth engine: deriveState(events)
│   ├── sovereign-bus.js     BroadcastChannel cross-tab sync
│   ├── identity.js          identity model: load/create/sign
│   └── migration-shim.js   legacy compat
│
├── transport/      I/O layer — byte movement, no meaning (depends: primitives)
│   ├── transport.js         4 variants + MultiTransport
│   ├── hybrid.js            validator ↔ P2P auto-switch (L4.5)
│   └── tunnel.js            SSE + WebRTC dual-lane (legacy)
│
├── protocol/       network layer (depends: primitives + transport + crypto)
│   ├── sovereign-network.js BFT gossip + quorum + IndexedDB
│   ├── ledger-bridge.js     event types I1-I6 + hash chain
│   └── identity-bridge.js  cross-surface identity sync
│
├── execution/      compute layer (depends: primitives + protocol)
│   ├── engine/     DETERMINISTIC — same input always = same output
│   │   ├── jsonflow.js        JSONFlow IR evaluator
│   │   ├── compiler.js        source → IR compiler
│   │   ├── genesis.js         genesis pipeline
│   │   ├── state.js           program state management
│   │   └── compute-bridge.js  UDCSEF dispatch
│   └── adapters/   NON-DETERMINISTIC — isolated, results enter via log.emit()
│       ├── ollama.js           local AI inference
│       └── kernel-adapter.js  6-view analysis
│
├── policy/         state transition policy (depends: execution/engine + primitives)
│   ├── economy.js   app registry, compute staking, IST settlement, markets
│   └── ist-flow.json IST token JSONFlow spec (Arbitrum One)
│
├── runtime/        wire + expose (depends: all layers)
│   ├── server.js    Node.js HTTP: static + SSE + WebRTC signaling + API
│   └── audit.js     system verification
│
└── ui/             spatial UI (read-only access to policy state)
    └── planespace/  Planespace v2 library
```

---

## The deterministic boundary

```
DETERMINISTIC (pure, replayable, auditable):
  crypto/
  primitives/
  execution/engine/

NON-DETERMINISTIC (isolated — may only affect state via log.emit()):
  transport/
  protocol/
  execution/adapters/
  policy/ (reads pure; writes go through log)
  runtime/
  ui/
```

If this line blurs → system becomes unreplayable.

---

## Key invariants

```
VM_stateₙ     = deriveState(eventLog[0..n])       sovereign-log
T_i           = hash(T_{i-1}, E_i, S_i, authorId) ledger-bridge
canonical     = sort(events, by hash)              protocol/network
finality      = >2/3 quorum ACK                    protocol/network
compute       = same IR → same output              execution/engine
transport     = variant: any substrate carries events
non-det       = results enter system only via log.emit()
```

---

## Quick start

```bash
node runtime/server.js        # port 3000
node runtime/server.js 8080   # custom port
```

---

## Runtime Targets

Prefer the explicit entrypoints when you know the environment:

- `trinity.node.js` for Node.js
- `trinity.browser.js` for browsers
- `trinity.js` remains as the compatibility wrapper

This reduces the old fallback-heavy "make everything work everywhere" surface and keeps the runtime adapter thinner.

---

## Licensing

This package is dual-licensed:

- `AGPL-3.0-or-later`
- Commercial/government terms described in the repository root `COMMERCIAL-LICENSE.md`

---

## Boot in browser

```html
<script src="crypto/wallet.js"></script>
<script src="primitives/sovereign-log.js"></script>
<script src="primitives/sovereign-bus.js"></script>
<script src="primitives/identity.js"></script>
<script src="protocol/ledger-bridge.js"></script>
<script src="protocol/identity-bridge.js"></script>
<script src="transport/transport.js"></script>
<script src="protocol/sovereign-network.js"></script>
<script src="execution/engine/jsonflow.js"></script>
<script src="execution/engine/compute-bridge.js"></script>
<script src="policy/economy.js"></script>
<script src="trinity.js"></script>
<script>
  Trinity.boot({
    api: 'http://localhost:3000/api',
  }).then(node => {
    window.node = node;
    console.log(node.diagnostics());

    // Emit a sovereign event
    node.emit('APP_PUBLISHED', {
      appId: 'my-app',
      title: 'My App',
      jsonflowProgram: {},
      priceIST: 10,
    });
  });
</script>
```

---

## See INTERFACES.md for formal layer contracts.

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

# Trinity SDK

> A deterministic state engine that syncs anywhere — local, P2P, AI, network.

One core primitive that unlocks three things:

| App | What it proves |
|-----|----------------|
| **Multiplayer Counter** | Real-time P2P sync, no backend |
| **AI Workflow** | Deterministic, auditable AI execution |
| **Offline Notes** | CRDT editing, works without internet |

---

## Mental model

```
EVENT → LOG → REDUCE → STATE
              ↓
            SYNC
              ↓
    (local / p2p / server / AI)
```

Every state change is an **event**. Events are appended to an immutable log. State is always reconstructible by replaying that log from scratch. This is the only invariant that must never be broken.

---

## Quick start

```bash
npm install
npm run dev:signal   # starts signal server + static file server
```

Open any app:
- `http://localhost:3000/apps/multiplayer-counter/`
- `http://localhost:3000/apps/ai-workflow/`
- `http://localhost:3000/apps/offline-notes/`

For P2P sync: open the same app in two browser tabs.

---

## Repo structure

```
trinity/
  core/
    createApp.js      ← THE foundation (start here)
    sync.js           ← attaches transport to app
    persist.js        ← localStorage event log persistence
  transport/
    local.js          ← no-op (offline / testing)
    webrtc.js         ← P2P via WebRTC DataChannels
    websocket.js      ← server-relay fallback
  crdt/
    crdt-text.js      ← RGA-style conflict-free text editing
  presence/
    presence.js       ← ephemeral cursors & user identity
  ai/
    runner.js         ← deterministic AI workflow engine
  signal-server/
    server.js         ← WebSocket signaling (Node.js)
  apps/
    multiplayer-counter/   ← App 1
    ai-workflow/           ← App 2
    offline-notes/         ← App 3
```

---

## Core SDK — the 30-line foundation

### `createApp({ init, reduce })`

```js
import { createApp } from "./core/createApp.js"

const app = createApp({
  init: 0,
  reduce: (state, event) => {
    if (event.type === "inc") return state + 1
    return state
  }
})

app.subscribe((state) => console.log(state))
app.emit({ type: "inc" })   // → 1
app.emit({ type: "inc" })   // → 2
```

**Rules (never break these):**
1. `reduce()` must be a pure function — no side effects
2. The log is append-only — never mutate history
3. State is always reconstructible by replaying `app.log`

### `attachSync(app, transport)`

Patches `app.emit` to also broadcast and wires `transport.onMessage` to apply incoming events:

```js
import { attachSync } from "./core/sync.js"
import { createWebRTCTransport } from "./transport/webrtc.js"

const transport = createWebRTCTransport("my-room")
attachSync(app, transport)

// Now app.emit() syncs to all peers in "my-room"
```

### `persist(app, key)`

Saves the event log to localStorage and replays it on startup:

```js
import { persist } from "./core/persist.js"
persist(app, "my-app-log")
```

---

## Transports

### Local (offline)

```js
import { localTransport } from "./transport/local.js"
attachSync(app, localTransport)
// Events stay local — no network traffic
```

### WebRTC (P2P)

```js
import { createWebRTCTransport } from "./transport/webrtc.js"

const transport = createWebRTCTransport("room-id", {
  signalUrl: "ws://localhost:8080",   // your signal server
  iceDiscoveryUrl: "http://localhost:8080/ice",
  authToken: "shared-room-token",
  maxPeers: 20,                       // hybrid mesh
  gossipTTL: 3,                       // relay hops
})
```

**What it handles:**
- Multi-peer mesh with gossip relay (scales past full-mesh)
- Deduplication via `_id`
- ICE restart on connection failure
- TURN/STUN discovery via `/ice` or a custom resolver
- Backpressure-aware queueing with bounded resync fallback
- Late-join sync (sends full event log to new peers)
- Ephemeral messages bypass the log

### WebSocket (server relay)

```js
import { createWSTransport } from "./transport/websocket.js"
const transport = createWSTransport("ws://localhost:8080", "room-id", {
  authToken: "shared-room-token",
})
```

---

## CRDT text editing

```js
import { createTextCRDT, createOps } from "./crdt/crdt-text.js"

const text = createTextCRDT()
const ops = createOps("peer-1")

// Insert characters
const op1 = ops.insert("H", "root")
const op2 = ops.insert("i", op1.id)

text.apply(op1)
text.apply(op2)
console.log(text.value())  // "Hi"

// Delete a character
text.apply(ops.del(op1.id))
console.log(text.value())  // "i"
```

Integrate into Trinity:

```js
import { createTextCRDT } from "./crdt/crdt-text.js"

const crdt = createTextCRDT()

const app = createApp({
  init: { text: "" },
  reduce(state, event) {
    if (event.type === "crdt.op") {
      crdt.apply(event.op)
      return { ...state, text: crdt.value() }
    }
    return state
  }
})

// Emit an insert op
app.emit({ type: "crdt.op", op: { type: "insert", id: "p1:0", value: "A", after: "root" } })
```

**Properties:** conflict-free concurrent inserts, commutative deletes, idempotent apply, fully replayable.

---

## Presence (ephemeral)

```js
import { createPresence } from "./presence/presence.js"

const presence = createPresence(transport, selfId)

// Broadcast your state (ephemeral — NOT logged)
presence.update({ x: 100, y: 200, color: "#ff0000" })

// Subscribe to all peers
presence.subscribe((peers) => {
  peers.forEach(p => renderCursor(p))
})
```

**Critical:** presence uses `_ephemeral: true` so it bypasses `attachSync` and never enters the deterministic log. This keeps your log clean and replayable.

---

## AI workflow

```js
import { createApp } from "./core/createApp.js"
import { attachAIRunner, aiReducer, aiInitialState } from "./ai/runner.js"

const app = createApp({
  init: { ...aiInitialState },
  reduce: (state, event) => aiReducer(state, event),
})

attachAIRunner(app, { apiKey: "sk-ant-..." })

// Trigger an AI task
app.emit({
  type: "ai.run",
  id: crypto.randomUUID(),
  prompt: "Summarize event sourcing in one paragraph.",
})

// State now contains:
// { tasks: { [id]: { status: "running" | "done" | "error", output: "..." } } }
```

**Why this is powerful:**
- Every prompt and every result is an event in the log
- The full workflow is replayable and auditable
- AI results are deterministic once emitted (the log stores the output, not the computation)
- Works with any AI API (swap `callAI` in `runner.js`)

---

## Determinism contract

The following invariant must hold at all times:

```js
function replayLog(log, init, reduce) {
  return log.reduce(reduce, init)
}

assert.deepEqual(
  replayLog(app.log, app.init, app.reduce),
  app.getState()
)
```

**What breaks determinism (never do these):**
- Calling `Date.now()` or `Math.random()` inside `reduce()`
- Mutating state directly (bypass `emit()`)
- Putting ephemeral/UI data (cursors, scroll position) in the log
- Logging AI results before they arrive (log the result event, not the computation)

---

## Running the signal server

```bash
node signal-server/server.js
# or
PORT=9000 node signal-server/server.js
```

Optional production env:

```bash
SIGNAL_AUTH_TOKENS=team-a-secret,team-b-secret
TRINITY_TURN_URLS=turn:turn.example.com:3478
TRINITY_TURN_USERNAME=relay-user
TRINITY_TURN_CREDENTIAL=relay-pass
node signal-server/server.js
```

The signal server only handles peer discovery and room relay. Durable application events remain in the client event log.

---

## Production Gaps (Honest Status)

Recent hardening landed in this package:

- [x] TURN/STUN auto-discovery and pluggable ICE server support
- [x] Backpressure-aware DataChannel queueing with bounded buffers
- [x] CRDT tombstone pruning and snapshot compaction hooks
- [x] Token-authenticated signaling and room admission checks

Still recommended before broader production rollout:

- [ ] Add stronger signed identity proofs for signaling
- [ ] Add sequence numbers per peer for strict ordering guarantees
- [ ] Replace localStorage with IndexedDB for large logs
- [ ] Tune snapshot and checkpoint policy for logs above 10k events

### Roadmap Fixes

- Signed signaling plus identity layer
- IndexedDB-backed persistence
- Backpressure metrics and transport observability
- Snapshot rotation for long-lived rooms

---

## What Trinity is NOT

- Not a database (no query layer)
- Not a framework (no opinions on UI)
- Not a blockchain (no consensus beyond P2P gossip)

It is the minimal primitive that everything else can be built on top of.

---

## License

Dual-licensed:

- `AGPL-3.0-or-later` for open-source use
- Commercial/government terms available via `COMMERCIAL-LICENSE.md`

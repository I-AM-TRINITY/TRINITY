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

# TRINITY — Interface Contracts
## Version 3.0 | Formal Specification

This document defines the **boundary contracts** between every layer.
A layer may only depend on layers below it. Violations are architectural bugs.

---

## Dependency order (bottom → top)

```
crypto          ← no dependencies
primitives      ← crypto
transport       ← primitives (identity only)
protocol        ← primitives + transport + crypto
execution       ← primitives + protocol
  engine        ← deterministic, no adapters
  adapters      ← engine interface + external I/O
policy          ← execution/engine + primitives
runtime         ← all layers (wires and exposes)
ui              ← policy + execution (read-only state)
trinity.js      ← composition root (instantiates all, no logic)
```

---

## crypto/wallet.js

**Responsibility**: Cryptographic primitives. No I/O. No state.

```typescript
interface TrinityWallet {
  // Key generation
  generateKeypairSync(): { address: string; privateKey: string }
  generateWalletSync():  { address: string; keyHex: string }

  // Signing (EIP-191 personal_sign)
  sign(message: string, privateKeyHex: string): Promise<string>
  recoverAddress(message: string, signature: string): string

  // Key storage (AES-GCM + PBKDF2)
  saveWallet(privateKeyHex: string, password: string): Promise<void>
  loadWallet(password: string): Promise<{ address: string; privateKey: string }>

  // Hashing
  keccak256(data: Uint8Array | string): string
  hashVoucherPassword(secret: string): string  // matches Solidity keccak256(abi.encodePacked)

  // Address utilities
  checksumAddress(address: string): string     // EIP-55
}
```

**Invariants**:
- Pure functions — same input always produces same output
- No network calls, no localStorage directly
- Works in both browser and Node.js

---

## primitives/sovereign-log.js

**Responsibility**: Deterministic event log. The system's truth engine.

```typescript
interface SovereignLog {
  // Write
  emit(event: {
    type:     string;
    payload:  unknown;
    authorId: string;
  }): LogEvent

  // Read
  getEvents(): LogEvent[]
  getState():  SystemState          // deriveState(events[0..n])

  // Subscribe
  on(type: string, fn: (event: LogEvent) => void): void
  on('*',          fn: (event: LogEvent) => void): void
  on('event',      fn: (event: LogEvent) => void): void  // all events
}

interface LogEvent {
  id:       string   // nonce / UUID
  type:     string
  payload:  unknown
  authorId: string
  ts:       number   // Unix ms
  hash:     string   // FNV-32 of (prevHash + type + authorId + payload + ts)
}
```

**Invariants**:
- `getState()` must equal `deriveState(getEvents())` at all times
- Events are append-only
- Hash chain is never broken: `event.hash = H(prev.hash, event)`
- No network calls, no external I/O

---

## primitives/identity.js

**Responsibility**: Identity model. Load/save/create. Pure.

```typescript
interface TrinityIdentity {
  createIdentity(name?: string): Identity
  loadIdentity():                Identity | null
  saveIdentity(id: Identity):    void
  ensureIdentity(name?: string): Identity           // load or create

  sign(identity: Identity, message: string):                         Promise<string | null>
  verify(message: string, sig: string, expectedAddress: string):     Promise<boolean>
}

interface Identity {
  id:       string    // Ethereum address (= keypair-derived)
  name:     string
  keyHex:   string    // private key hex (stored encrypted)
  ts:       number
  canSign:  boolean
}
```

---

## transport/transport.js

**Responsibility**: Move bytes. No protocol meaning. No identity.

```typescript
interface Transport {
  send(envelope: Envelope): void
  on(type: string,  fn: (envelope: Envelope) => void): this
  on('*',           fn: (envelope: Envelope) => void): this
  peers(): string[]
  ready: boolean
  close(): void
}

interface Envelope {
  nonce:    string    // deduplication key
  type:     string    // event type (opaque to transport)
  payload:  unknown
  authorId: string
  ts:       number
  hash?:    string
}
```

**Variants** (all implement Transport):

| Class               | Mechanism                        | Internet required |
|---------------------|----------------------------------|-------------------|
| `LocalTransport`    | BroadcastChannel                 | No                |
| `SSETransport`      | HTTP Server-Sent Events          | Local server only |
| `WebRTCTransport`   | PeerJS DataChannel (P2P)         | Bootstrap only    |
| `ValidatorTransport`| HTTP validator endpoint          | Yes               |
| `MultiTransport`    | All variants simultaneously      | —                 |

**Invariants**:
- Transport does NOT parse payload semantics
- Deduplication by `nonce` in `MultiTransport`
- Internet used only for WebRTC STUN/signaling bootstrap
- Once WebRTC channels open, messages flow with no server

---

## protocol/ledger-bridge.js

**Responsibility**: Event type registry + hash chain for cross-node verification.

```typescript
interface SovereignLedgerBridge {
  // Attach to a log instance
  attach(log: SovereignLog): void

  // Verify hash chain integrity
  verifyChain(events: LogEvent[]): { valid: boolean; brokenAt?: number }

  // Canonical event type registry (I1-I6)
  EventTypes: {
    I1_IDENTITY:   'IDENTITY_CREATED'
    I2_COMPUTE:    'COMPUTE_DISPATCHED'
    I3_SETTLE:     'EXECUTION_SETTLED'
    I4_STAKE:      'STAKE_DEPOSITED'
    I5_SLASH:      'STAKE_SLASHED'
    I6_FINALITY:   'BLOCK_FINALIZED'
  }
}
```

---

## protocol/sovereign-network.js

**Responsibility**: Gossip + BFT quorum + IndexedDB persistence. Protocol, not execution.

```typescript
interface SovereignNetwork {
  // Receive an event from a remote peer
  receiveRemoteEvent(envelope: Envelope): Promise<void>

  // Query finality
  isFinalized(eventId: string): boolean

  // BFT quorum: >2/3 of known peers must ACK before finality
  quorumSize(): number
  acknowledgedBy(eventId: string): string[]  // peer IDs that ACKed
}
```

**Invariants**:
- Does NOT implement compute logic
- Does NOT implement economy rules
- Only routes and validates protocol messages

---

## execution/engine/ (deterministic compute)

**Responsibility**: Execute JSONFlow programs deterministically.

```typescript
interface JSONFlowEngine {
  // Compile a JSONFlow program from source
  compile(source: object): CompiledProgram

  // Execute — must be pure: same IR + same input = same output, always
  execute(program: CompiledProgram, input: unknown, state: unknown): ExecutionResult
}

interface ExecutionResult {
  output:    unknown
  nextState: unknown
  events:    LogEvent[]   // events emitted during execution
  hash:      string       // deterministic output hash
}
```

**Invariants**:
- **No I/O inside execute()** — no fetch, no localStorage, no Date.now(), no Math.random()
- Same inputs always produce same outputs (referential transparency)
- All randomness must be injected as input, never generated internally

---

## execution/adapters/ (non-deterministic, isolated)

**Responsibility**: Bridge non-deterministic external systems to the engine interface.

```typescript
// adapters/ollama.js
interface OllamaAdapter {
  query(prompt: string, opts?: { model?: string }): Promise<string>
  embed(text: string): Promise<number[]>
  // Results are fed INTO the log as events — never called from inside execute()
}
```

**Invariants**:
- Adapters are NEVER called from inside execution/engine/
- Results always enter the system through `log.emit()`, making them auditable
- An adapter failure must never corrupt system state

---

## policy/economy.js

**Responsibility**: State transition policy. Derives economic state from the log.

```typescript
interface TrinityEconomy {
  // Actions (emit events to log — no direct state mutation)
  publishApp(opts: AppSpec):        LogEvent
  installApp(opts: { appId }):      LogEvent
  depositStake(opts: { amount }):   LogEvent
  settleExecution(opts: Settlement): { creatorAmount: number; nodeAmount: number; protocolAmount: number }
  placeBet(opts: BetSpec):          LogEvent
  resolveBet(opts: BetResolution):  LogEvent

  // Queries (pure reads from log — no side effects)
  getApps():              Record<string, App>
  getNodes():             Record<string, Node>
  getBets():              Record<string, Bet>
  getApp(appId: string):  App | null
  getLeaderboard():       App[]
  getNodeHealth(nodeId):  NodeHealth | null
}
```

**Revenue split constants** (fixed, not configurable at runtime):
```
CREATOR:   70%
COMPUTE:   20%
PROTOCOL:  10%
```

**Invariants**:
- All mutations go through `log.emit()` — no direct state writes
- All queries use `deriveApps(log.getEvents())` — pure derivation
- Policy does not call transport, network, or adapters directly

---

## runtime/server.js

**Responsibility**: Wire and expose. No business logic.

Exposes:
- `GET  /`                  → static portal
- `GET  /api/events`        → SSE stream
- `POST /api/broadcast`     → fan out to SSE clients
- `POST /api/rtc/register`  → WebRTC signaling: register peer
- `POST /api/rtc/signal`    → WebRTC signaling: relay offer/answer/candidate
- `GET  /api/rtc/inbox`     → WebRTC signaling: poll for messages
- `GET  /api/ledger`        → read log events (paginated)
- `POST /api/emit`          → emit event to log
- `GET  /api/apps`          → list apps from economy
- `POST /api/apps`          → publish app
- `POST /api/stake`         → deposit stake
- `POST /api/settle`        → settle execution

**Invariants**:
- Server routes call policy/network methods — they do not implement them
- All business validation happens in policy/execution layers
- Server is replaceable (swap Node.js for Deno, Bun, CF Workers)

---

## Deterministic boundary

This is the critical line in the system:

```
DETERMINISTIC (must be pure, replayable, auditable):
  crypto/
  primitives/
  execution/engine/

NON-DETERMINISTIC (may have side effects, must be isolated):
  transport/
  protocol/
  execution/adapters/
  policy/              ← reads are pure; writes go through log
  runtime/
  ui/
```

**Rule**: Non-deterministic code may only affect system state by calling `log.emit()`.
Any other path to state mutation is a bug.

---

## Event type registry (canonical)

All event types in the system. New types extend this list.

```
IDENTITY_CREATED          primitives
IDENTITY_UPDATED          primitives

COMPUTE_DISPATCHED        execution
EXECUTION_SETTLED         execution

APP_PUBLISHED             policy
APP_INSTALLED             policy
COMPUTE_BID               policy
REVENUE_SPLIT             policy
STAKE_DEPOSITED           policy
STAKE_SLASHED             policy
BET_PLACED                policy
BET_RESOLVED              policy

BLOCK_FINALIZED           protocol
PEER_JOINED               protocol
PEER_LEFT                 protocol
HYBRID_MODE_CHANGED       protocol
HYBRID_RESYNC             protocol

KERNEL_ANALYSIS           adapters (from ollama)
```

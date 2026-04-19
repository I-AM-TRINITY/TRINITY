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
 * trinity/tests/core.test.js
 *
 * Tests for the Trinity SDK core.
 * Validates the determinism contract:
 *   replay(log, init, reduce) === currentState
 *
 * Run:
 *   node --test tests/core.test.js
 */

import { describe, it } from "node:test"
import assert from "node:assert/strict"

// Node 22 ships globalThis.crypto natively — no polyfill needed.

// ─── Imports ──────────────────────────────────────────────────
const { createApp } = await import("../core/createApp.js")
const { createTextCRDT, createOps } = await import("../crdt/crdt-text.js")
const { aiReducer, aiInitialState } = await import("../ai/runner.js")
const { normalizeIceServers, mergeIceServerSources } = await import("../transport/webrtc.js")

// ─── Helpers ──────────────────────────────────────────────────
function counterApp() {
  return createApp({
    init: 0,
    reduce: (state, event) => {
      if (event.type === "inc") return state + 1
      if (event.type === "dec") return state - 1
      if (event.type === "reset") return 0
      return state
    },
  })
}

// ─── Core: createApp ──────────────────────────────────────────

describe("createApp", () => {

  it("initialises with correct state", () => {
    const app = counterApp()
    assert.equal(app.getState(), 0)
  })

  it("applies events via reduce", () => {
    const app = counterApp()
    app.emit({ type: "inc" })
    app.emit({ type: "inc" })
    app.emit({ type: "dec" })
    assert.equal(app.getState(), 1)
  })

  it("stamps every event with _id and _ts", () => {
    const app = counterApp()
    app.emit({ type: "inc" })
    const [e] = app.log
    assert.ok(typeof e._id === "string", "_id must be a string")
    assert.ok(typeof e._ts === "number", "_ts must be a number")
  })

  it("stamps every event with _seq", () => {
    const app = counterApp()
    app.emit({ type: "inc" })
    app.emit({ type: "inc" })
    assert.equal(app.log[0]._seq, 0)
    assert.equal(app.log[1]._seq, 1)
  })

  it("preserves _id if already set", () => {
    const app = counterApp()
    const id = crypto.randomUUID()
    app.emit({ type: "inc", _id: id })
    assert.equal(app.log[0]._id, id)
  })

  it("log is append-only and grows monotonically", () => {
    const app = counterApp()
    for (let i = 0; i < 5; i++) app.emit({ type: "inc" })
    assert.equal(app.log.length, 5)
    // Verify seqs are in order
    for (let i = 0; i < 5; i++) {
      assert.equal(app.log[i]._seq, i)
    }
  })

  it("notifies subscribers on emit", () => {
    const app = counterApp()
    const calls = []
    app.subscribe((state, event) => calls.push({ state, event }))
    app.emit({ type: "inc" })
    app.emit({ type: "inc" })
    assert.equal(calls.length, 2)
    assert.equal(calls[0].state, 1)
    assert.equal(calls[1].state, 2)
  })

  it("unsubscribe stops notifications", () => {
    const app = counterApp()
    let count = 0
    const unsub = app.subscribe(() => count++)
    app.emit({ type: "inc" })
    unsub()
    app.emit({ type: "inc" })
    assert.equal(count, 1)
  })

  it("supports multiple independent subscribers", () => {
    const app = counterApp()
    const a = [], b = []
    app.subscribe((s) => a.push(s))
    app.subscribe((s) => b.push(s))
    app.emit({ type: "inc" })
    assert.deepEqual(a, b)
  })

})

// ─── DETERMINISM: The core invariant ──────────────────────────

describe("determinism invariant", () => {

  it("replaying log from scratch produces the same state", () => {
    const app = counterApp()
    app.emit({ type: "inc" })
    app.emit({ type: "inc" })
    app.emit({ type: "dec" })
    app.emit({ type: "inc" })
    app.emit({ type: "reset" })
    app.emit({ type: "inc" })

    const { init, reduce } = { init: 0, reduce: app._reduce }

    // Manually replay
    const replayedState = app.log.reduce((s, e) => {
      if (e.type === "inc") return s + 1
      if (e.type === "dec") return s - 1
      if (e.type === "reset") return 0
      return s
    }, 0)

    assert.equal(replayedState, app.getState())
  })

  it("app.replay() skips duplicate events by _id", () => {
    const app = counterApp()
    app.emit({ type: "inc" })
    const originalLength = app.log.length
    const originalState = app.getState()

    // Replaying the same log should be idempotent
    app.replay(app.log)

    assert.equal(app.log.length, originalLength, "log must not grow on duplicate replay")
    assert.equal(app.getState(), originalState, "state must not change on duplicate replay")
  })

  it("reduce() is never called with undefined", () => {
    const app = createApp({
      init: { count: 0 },
      reduce(state, event) {
        assert.ok(state !== undefined, "state must never be undefined")
        assert.ok(event !== undefined, "event must never be undefined")
        if (event.type === "inc") return { count: state.count + 1 }
        return state
      },
    })
    app.emit({ type: "inc" })
    app.emit({ type: "noop" })
  })

})

// ─── CRDT: crdt-text ──────────────────────────────────────────

describe("crdt-text", () => {

  it("inserts characters in order", () => {
    const text = createTextCRDT()
    const ops = createOps("peer-a")
    const op1 = ops.insert("H", "root")
    const op2 = ops.insert("i", op1.id)
    text.apply(op1)
    text.apply(op2)
    assert.equal(text.value(), "Hi")
  })

  it("insert is idempotent (applying twice is safe)", () => {
    const text = createTextCRDT()
    const ops = createOps("peer-a")
    const op = ops.insert("X", "root")
    text.apply(op)
    text.apply(op)  // second apply must be no-op
    assert.equal(text.value(), "X")
  })

  it("deletes characters (tombstone)", () => {
    const text = createTextCRDT()
    const ops = createOps("peer-a")
    const op1 = ops.insert("A", "root")
    const op2 = ops.insert("B", op1.id)
    text.apply(op1)
    text.apply(op2)
    text.apply(ops.del(op1.id))
    assert.equal(text.value(), "B")
  })

  it("delete is idempotent", () => {
    const text = createTextCRDT()
    const ops = createOps("peer-a")
    const op = ops.insert("X", "root")
    text.apply(op)
    text.apply(ops.del(op.id))
    text.apply(ops.del(op.id))  // second delete is no-op
    assert.equal(text.value(), "")
  })

  it("concurrent inserts from two peers are deterministic", () => {
    // Both peers insert at the same position (root).
    // The final order must be identical regardless of apply order.

    const opsA = createOps("peer-a")
    const opsB = createOps("peer-b")

    const opA = opsA.insert("A", "root")
    const opB = opsB.insert("B", "root")

    const textAB = createTextCRDT()
    textAB.apply(opA)
    textAB.apply(opB)

    const textBA = createTextCRDT()
    textBA.apply(opB)
    textBA.apply(opA)

    // Both orderings must produce the same string
    assert.equal(textAB.value(), textBA.value(),
      "Concurrent inserts must converge regardless of apply order")
  })

  it("builds a word character by character", () => {
    const text = createTextCRDT()
    const ops = createOps("p")
    const word = "Trinity"
    let prev = "root"
    for (const ch of word) {
      const op = ops.insert(ch, prev)
      text.apply(op)
      prev = op.id
    }
    assert.equal(text.value(), "Trinity")
  })

  it("lastId() returns root for empty doc", () => {
    const text = createTextCRDT()
    assert.equal(text.lastId(), "root")
  })

  it("lastId() returns id of last visible node", () => {
    const text = createTextCRDT()
    const ops = createOps("p")
    const op = ops.insert("Z", "root")
    text.apply(op)
    assert.equal(text.lastId(), op.id)
  })

  it("reorders pending inserts when the missing anchor arrives", () => {
    const text = createTextCRDT()
    const late = { type: "insert", id: "peer:1", value: "B", after: "peer:0" }
    const first = { type: "insert", id: "peer:0", value: "A", after: "root" }

    text.apply(late)
    text.apply(first)

    assert.equal(text.value(), "AB")
  })

  it("supports delete-before-insert ordering safely", () => {
    const text = createTextCRDT()

    text.apply({ type: "delete", id: "peer:0" })
    text.apply({ type: "insert", id: "peer:0", value: "X", after: "root" })

    assert.equal(text.value(), "")
  })

  it("compacts snapshots and reloads them without changing visible text", () => {
    const text = createTextCRDT()
    const ops = createOps("peer-a")

    const op1 = ops.insert("H", "root")
    const op2 = ops.insert("i", op1.id)
    text.apply(op1)
    text.apply(op2)
    text.apply(ops.del(op1.id))

    const compact = text.exportSnapshot({ compact: true })
    const restored = createTextCRDT(compact)

    assert.equal(restored.value(), "i")
  })

  it("garbage-collects old tombstones once they fall outside the version window", () => {
    const text = createTextCRDT()
    const ops = createOps("peer-a")

    const a = ops.insert("A", "root")
    const b = ops.insert("B", a.id)
    text.apply(a)
    text.apply(b)
    text.apply(ops.del(b.id))

    const before = text.stats().tombstones
    const result = text.gc({ versionWindow: 0 })

    assert.equal(before, 1)
    assert.equal(result.pruned, 1)
    assert.equal(text.stats().tombstones, 0)
  })

})

// ─── Transport helpers ────────────────────────────────────────

describe("transport helper utilities", () => {

  it("normalizes ICE server urls into arrays and deduplicates entries", () => {
    const normalized = normalizeIceServers([
      { urls: "stun:stun.example.net" },
      { urls: ["stun:stun.example.net"] },
      { urls: ["turn:turn.example.net"], username: "u", credential: "c" },
    ])

    assert.equal(normalized.length, 2)
    assert.deepEqual(normalized[0].urls, ["stun:stun.example.net"])
    assert.deepEqual(normalized[1].urls, ["turn:turn.example.net"])
  })

  it("falls back to default ICE servers when no custom list is provided", () => {
    const merged = mergeIceServerSources()
    assert.ok(merged.length > 0)
    assert.ok(Array.isArray(merged[0].urls))
  })

})

// ─── CRDT + Trinity reducer integration ───────────────────────

describe("CRDT inside Trinity reducer", () => {

  it("state.text reflects CRDT value after ops", () => {
    const crdt = createTextCRDT()
    const ops = createOps("peer-x")

    const app = createApp({
      init: { text: "" },
      reduce(state, event) {
        if (event.type === "crdt.op") {
          crdt.apply(event.op)
          return { ...state, text: crdt.value() }
        }
        return state
      },
    })

    app.emit({ type: "crdt.op", op: ops.insert("H", "root") })
    app.emit({ type: "crdt.op", op: ops.insert("i", app.log[0].op.id) })

    assert.equal(app.getState().text, "Hi")
  })

  it("replaying crdt log reconstructs the same text", () => {
    const crdt1 = createTextCRDT()
    const ops = createOps("peer-x")

    const app = createApp({
      init: { text: "" },
      reduce(state, event) {
        if (event.type === "crdt.op") {
          crdt1.apply(event.op)
          return { ...state, text: crdt1.value() }
        }
        return state
      },
    })

    const word = "hello"
    let prev = "root"
    for (const ch of word) {
      const op = ops.insert(ch, prev)
      app.emit({ type: "crdt.op", op })
      prev = op.id
    }

    const savedLog = [...app.log]

    // Build a fresh app from the saved log
    const crdt2 = createTextCRDT()
    const app2 = createApp({
      init: { text: "" },
      reduce(state, event) {
        if (event.type === "crdt.op") {
          crdt2.apply(event.op)
          return { ...state, text: crdt2.value() }
        }
        return state
      },
    })

    app2.replay(savedLog)

    assert.equal(app2.getState().text, "hello",
      "Replayed CRDT log must produce the same text")
  })

})

// ─── AI reducer ───────────────────────────────────────────────

describe("aiReducer", () => {

  it("initialises tasks as empty object", () => {
    const app = createApp({
      init: { ...aiInitialState },
      reduce: (s, e) => aiReducer(s, e),
    })
    assert.deepEqual(app.getState().tasks, {})
  })

  it("ai.run creates a queued task", () => {
    const app = createApp({
      init: { ...aiInitialState },
      reduce: (s, e) => aiReducer(s, e),
    })
    const id = "task-1"
    app.emit({ type: "ai.run", id, prompt: "hello" })
    const task = app.getState().tasks[id]
    assert.equal(task.status, "queued")
    assert.equal(task.prompt, "hello")
  })

  it("ai.status transitions to running", () => {
    const app = createApp({
      init: { ...aiInitialState },
      reduce: (s, e) => aiReducer(s, e),
    })
    const id = "task-1"
    app.emit({ type: "ai.run", id, prompt: "hello" })
    app.emit({ type: "ai.status", id, status: "running" })
    assert.equal(app.getState().tasks[id].status, "running")
  })

  it("ai.result sets output and status=done", () => {
    const app = createApp({
      init: { ...aiInitialState },
      reduce: (s, e) => aiReducer(s, e),
    })
    const id = "task-1"
    app.emit({ type: "ai.run", id, prompt: "hello" })
    app.emit({ type: "ai.result", id, output: "world", model: "test-model", finishedAt: Date.now() })
    const task = app.getState().tasks[id]
    assert.equal(task.status, "done")
    assert.equal(task.output, "world")
  })

  it("ai.error sets status=error", () => {
    const app = createApp({
      init: { ...aiInitialState },
      reduce: (s, e) => aiReducer(s, e),
    })
    const id = "task-1"
    app.emit({ type: "ai.run", id, prompt: "hello" })
    app.emit({ type: "ai.error", id, error: "timeout" })
    const task = app.getState().tasks[id]
    assert.equal(task.status, "error")
    assert.equal(task.error, "timeout")
  })

  it("AI workflow log is fully replayable", () => {
    const app = createApp({
      init: { ...aiInitialState },
      reduce: (s, e) => aiReducer(s, e),
    })

    const id = "task-replay"
    app.emit({ type: "ai.run", id, prompt: "test" })
    app.emit({ type: "ai.status", id, status: "running" })
    app.emit({ type: "ai.result", id, output: "ok", model: "m", finishedAt: 0 })

    const savedLog = [...app.log]

    const app2 = createApp({
      init: { ...aiInitialState },
      reduce: (s, e) => aiReducer(s, e),
    })
    app2.replay(savedLog)

    assert.equal(app2.getState().tasks[id].status, "done")
    assert.equal(app2.getState().tasks[id].output, "ok")
  })

})

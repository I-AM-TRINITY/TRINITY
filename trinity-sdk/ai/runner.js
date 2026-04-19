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
 * trinity/ai/runner.js
 *
 * Deterministic AI workflow runner.
 *
 * The key idea:
 *   AI is non-deterministic at the boundary (the model call).
 *   But once the result is emitted as an event, it becomes
 *   part of the deterministic log — replayable and auditable.
 *
 * Flow:
 *   1. app.emit({ type: "ai.run", id, prompt, model })
 *   2. runner intercepts "ai.run" events
 *   3. runner calls the AI API (the non-deterministic boundary)
 *   4. runner emits { type: "ai.result", id, output } back into the app
 *   5. reducer stores the result deterministically
 *
 * This means:
 *   ✓ Every input prompt is logged
 *   ✓ Every output is logged
 *   ✓ The full workflow is replayable
 *   ✓ No result is computed twice (idempotent via task ID)
 *
 * Usage:
 *   import { attachAIRunner } from "../ai/runner.js"
 *   attachAIRunner(app, { apiKey: "sk-..." })
 */

export function attachAIRunner(app, options = {}) {
  const {
    model = "claude-haiku-4-5-20251001",
    apiUrl = "https://api.anthropic.com/v1/messages",
    apiKey = null,
    onError = console.error,
  } = options

  // Track which task IDs have already been handled in this session.
  // This prevents double-running if an "ai.run" event arrives via sync.
  const handled = new Set()

  // Watch the app's event stream for "ai.run" events
  app.subscribe(async (_state, event) => {
    if (event.type !== "ai.run") return
    if (handled.has(event.id)) return

    handled.add(event.id)

    // Emit "in progress" status so the UI can show a spinner
    app.emit({
      type: "ai.status",
      id: event.id,
      status: "running",
    })

    try {
      const output = await callAI({
        prompt: event.prompt,
        systemPrompt: event.systemPrompt,
        model,
        apiUrl,
        apiKey,
      })

      // Emit the result — this is now deterministic history
      app.emit({
        type: "ai.result",
        id: event.id,
        output,
        model,
        finishedAt: Date.now(),
      })
    } catch (err) {
      onError(err)

      app.emit({
        type: "ai.error",
        id: event.id,
        error: err.message,
      })
    }
  })
}

// --- AI call (the non-deterministic boundary) ---
async function callAI({ prompt, systemPrompt, model, apiUrl, apiKey }) {
  const headers = {
    "Content-Type": "application/json",
    "anthropic-version": "2023-06-01",
    "anthropic-dangerous-direct-browser-calls": "true",
  }

  if (apiKey) {
    headers["x-api-key"] = apiKey
  }

  const body = {
    model,
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  }

  if (systemPrompt) {
    body.system = systemPrompt
  }

  const res = await fetch(apiUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`AI API error ${res.status}: ${err}`)
  }

  const data = await res.json()
  return data.content?.[0]?.text ?? ""
}

// --- Reducer helpers ---
// Drop these into your app's reduce() function.

/**
 * Initial state shape for AI workflow tracking.
 */
export const aiInitialState = {
  tasks: {},   // id → { prompt, status, output, error }
}

/**
 * Pure reducer slice for AI events.
 * Merge this into your own reducer.
 *
 * @example
 *   function reduce(state, event) {
 *     return aiReducer(myReducer(state, event), event)
 *   }
 */
export function aiReducer(state, event) {
  switch (event.type) {
    case "ai.run":
      return {
        ...state,
        tasks: {
          ...state.tasks,
          [event.id]: {
            id: event.id,
            prompt: event.prompt,
            systemPrompt: event.systemPrompt ?? null,
            status: "queued",
            output: null,
            error: null,
            createdAt: event._ts,
          },
        },
      }

    case "ai.status":
      return mergeTask(state, event.id, { status: event.status })

    case "ai.result":
      return mergeTask(state, event.id, {
        status: "done",
        output: event.output,
        model: event.model,
        finishedAt: event.finishedAt,
      })

    case "ai.error":
      return mergeTask(state, event.id, {
        status: "error",
        error: event.error,
      })

    default:
      return state
  }
}

function mergeTask(state, id, patch) {
  const task = state.tasks[id]
  if (!task) return state

  return {
    ...state,
    tasks: {
      ...state.tasks,
      [id]: { ...task, ...patch },
    },
  }
}

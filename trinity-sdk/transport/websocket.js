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

export function createWSTransport(url, roomId, options = {}) {
  const { authToken = null, auth = null, identity = null } = options

  const listeners = []
  const seen = new Set()
  const queue = []

  let ws = null
  let ready = false

  function connect() {
    ws = new WebSocket(url)

    ws.onopen = () => {
      ready = true
      ws.send(
        JSON.stringify({
          type: "_join",
          room: roomId,
          auth: buildAuthPayload(auth, authToken),
          identity,
        })
      )

      while (queue.length > 0) {
        ws.send(queue.shift())
      }
    }

    ws.onmessage = (event) => {
      const payload = safeJsonParse(event.data)
      if (!payload) return

      if (payload.type === "joined") return

      if (payload.type === "error") {
        console.warn(`[trinity] websocket transport rejected request: ${payload.message}`)
        return
      }

      if (payload._ephemeral) {
        listeners.forEach((fn) => fn(payload))
        return
      }

      if (seen.has(payload._id)) return
      seen.add(payload._id)
      listeners.forEach((fn) => fn(payload))
    }

    ws.onclose = () => {
      ready = false
      setTimeout(connect, 2000)
    }
  }

  connect()

  function broadcast(event) {
    const enriched = {
      ...event,
      _id: event._id ?? crypto.randomUUID(),
      _ts: event._ts ?? Date.now(),
    }

    const payload = JSON.stringify({ ...enriched, _room: roomId })
    if (ready && ws?.readyState === WebSocket.OPEN) {
      ws.send(payload)
    } else {
      queue.push(payload)
    }
  }

  function onMessage(fn) {
    listeners.push(fn)
    return () => {
      const idx = listeners.indexOf(fn)
      if (idx !== -1) listeners.splice(idx, 1)
    }
  }

  return { broadcast, onMessage }
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function buildAuthPayload(auth, authToken) {
  if (!auth && !authToken) return null
  if (!auth) return { token: authToken }
  return authToken ? { ...auth, token: auth.token ?? authToken } : auth
}

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

import { createServer } from "http"
import { randomUUID } from "node:crypto"
import { WebSocketServer } from "ws"

const PORT = Number(process.env.PORT || 8080)
const GLOBAL_TOKENS = parseTokenSet(
  process.env.SIGNAL_AUTH_TOKENS || process.env.SIGNAL_AUTH_TOKEN || ""
)
const ROOM_TOKENS = parseRoomTokens(process.env.SIGNAL_ROOM_TOKENS_JSON || "")
const ICE_SERVERS = buildIceServers()

const rooms = new Map() // roomId -> Map<peerId, { ws, identity }>

const httpServer = createServer((req, res) => {
  if (req.url === "/health") {
    respondJson(res, 200, {
      ok: true,
      authRequired: authIsEnabled(),
      iceServers: ICE_SERVERS.length,
    })
    return
  }

  if (req.url === "/ice") {
    respondJson(res, 200, { iceServers: ICE_SERVERS })
    return
  }

  res.writeHead(404)
  res.end()
})

const wss = new WebSocketServer({ server: httpServer })

wss.on("connection", (ws) => {
  let roomId = null
  let peerIdentity = null
  const peerId = randomUUID()

  send(ws, {
    type: "init",
    peerId,
    authRequired: authIsEnabled(),
    iceDiscoveryUrl: `http://localhost:${PORT}/ice`,
  })

  ws.on("message", (raw) => {
    const data = safeJsonParse(raw)
    if (!data) return

    if (data.type === "join" || data.type === "_join") {
      const joinRoomId = sanitizeRoomId(data.room)
      if (!joinRoomId) {
        reject(ws, "Invalid room id")
        return
      }

      if (!authorizeJoin(joinRoomId, data.auth)) {
        reject(ws, "Authentication required for this room")
        return
      }

      roomId = joinRoomId
      peerIdentity = sanitizeIdentity(data.identity)

      if (!rooms.has(roomId)) rooms.set(roomId, new Map())
      const room = rooms.get(roomId)

      if (data.type === "join") {
        send(ws, {
          type: "peers",
          peers: Array.from(room.keys()),
        })

        room.forEach((peer) => {
          send(peer.ws, { type: "peer-join", peerId })
        })
      } else {
        send(ws, { type: "joined", room: roomId })
      }

      room.set(peerId, { ws, identity: peerIdentity })
      return
    }

    if (!roomId) {
      reject(ws, "Join a room before sending transport traffic")
      return
    }

    if (data.type === "signal") {
      const room = rooms.get(roomId)
      if (!room) return

      const target = room.get(data.to)
      if (!target) return

      send(target.ws, {
        type: "signal",
        from: peerId,
        identity: peerIdentity,
        signal: data.signal,
      })
      return
    }

    const relayRoomId = sanitizeRoomId(data._room) || roomId
    const room = rooms.get(relayRoomId)
    if (!room) return

    room.forEach((peer, id) => {
      if (id === peerId || peer.ws.readyState !== 1) return
      peer.ws.send(raw)
    })
  })

  ws.on("close", () => {
    if (!roomId) return
    const room = rooms.get(roomId)
    if (!room) return

    room.delete(peerId)

    room.forEach((peer) => {
      send(peer.ws, { type: "peer-leave", peerId })
    })

    if (room.size === 0) {
      rooms.delete(roomId)
    }
  })
})

function authorizeJoin(roomId, auth) {
  if (!authIsEnabled()) return true

  const token = typeof auth === "string" ? auth : auth?.token
  if (!token) return false

  const roomTokens = ROOM_TOKENS.get(roomId)
  if (roomTokens?.size) {
    return roomTokens.has(token)
  }

  return GLOBAL_TOKENS.has(token)
}

function authIsEnabled() {
  return GLOBAL_TOKENS.size > 0 || ROOM_TOKENS.size > 0
}

function sanitizeRoomId(value) {
  if (typeof value !== "string") return null
  const roomId = value.trim()
  if (!roomId || roomId.length > 128) return null
  return roomId
}

function sanitizeIdentity(identity) {
  if (!identity || typeof identity !== "object") return null
  return {
    id: typeof identity.id === "string" ? identity.id.slice(0, 128) : null,
    name: typeof identity.name === "string" ? identity.name.slice(0, 128) : null,
  }
}

function reject(ws, message) {
  send(ws, { type: "error", message })
  ws.close(4001, message)
}

function send(ws, data) {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify(data))
  }
}

function safeJsonParse(raw) {
  try {
    return JSON.parse(typeof raw === "string" ? raw : raw.toString("utf8"))
  } catch {
    return null
  }
}

function respondJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  })
  res.end(body)
}

function parseTokenSet(input) {
  return new Set(
    String(input)
      .split(",")
      .map((token) => token.trim())
      .filter(Boolean)
  )
}

function parseRoomTokens(raw) {
  if (!raw) return new Map()

  try {
    const parsed = JSON.parse(raw)
    return new Map(
      Object.entries(parsed).map(([room, tokens]) => {
        const values = Array.isArray(tokens) ? tokens : [tokens]
        return [room, new Set(values.filter(Boolean))]
      })
    )
  } catch {
    console.warn("[trinity] SIGNAL_ROOM_TOKENS_JSON is invalid JSON; ignoring it")
    return new Map()
  }
}

function buildIceServers() {
  const explicitJson = process.env.TRINITY_ICE_SERVERS_JSON || process.env.ICE_SERVERS_JSON
  if (explicitJson) {
    try {
      const parsed = JSON.parse(explicitJson)
      const servers = Array.isArray(parsed) ? parsed : parsed.iceServers
      if (Array.isArray(servers) && servers.length > 0) return servers
    } catch {
      console.warn("[trinity] invalid ICE server JSON; falling back to env-derived defaults")
    }
  }

  const stunUrls = splitList(
    process.env.TRINITY_STUN_URLS || "stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302"
  )

  const turnUrls = splitList(process.env.TRINITY_TURN_URLS || "")
  const turnUsername = process.env.TRINITY_TURN_USERNAME || ""
  const turnCredential = process.env.TRINITY_TURN_CREDENTIAL || ""

  const servers = []

  if (stunUrls.length > 0) {
    servers.push({ urls: stunUrls })
  }

  if (turnUrls.length > 0) {
    servers.push({
      urls: turnUrls,
      username: turnUsername,
      credential: turnCredential,
    })
  }

  return servers
}

function splitList(value) {
  return String(value)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
}

httpServer.listen(PORT, () => {
  console.log(`Trinity signal server listening on ws://localhost:${PORT}`)
  console.log(`Health check: http://localhost:${PORT}/health`)
  console.log(`ICE discovery: http://localhost:${PORT}/ice`)
  if (authIsEnabled()) {
    console.log("Signal server auth: enabled")
  }
})

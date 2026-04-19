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

export const DEFAULT_ICE_SERVERS = [
  {
    urls: [
      "stun:stun.l.google.com:19302",
      "stun:stun1.l.google.com:19302",
    ],
  },
]

const DEFAULT_BUFFERED_AMOUNT_HIGH_WATER_MARK = 1_000_000
const DEFAULT_BUFFERED_AMOUNT_LOW_WATER_MARK = 256_000
const DEFAULT_MAX_QUEUED_MESSAGES = 256

export function normalizeIceServers(input) {
  const servers = Array.isArray(input)
    ? input
    : Array.isArray(input?.iceServers)
      ? input.iceServers
      : []

  const deduped = []
  const seen = new Set()

  servers.forEach((server) => {
    if (!server || !server.urls) return

    const urls = Array.isArray(server.urls)
      ? server.urls.filter(Boolean)
      : [server.urls].filter(Boolean)

    if (urls.length === 0) return

    const normalized = {
      ...server,
      urls,
    }

    const key = JSON.stringify([
      normalized.urls,
      normalized.username ?? "",
      normalized.credential ?? "",
    ])

    if (seen.has(key)) return
    seen.add(key)
    deduped.push(normalized)
  })

  return deduped
}

export function mergeIceServerSources(...sources) {
  const merged = normalizeIceServers(sources.flatMap((source) => normalizeIceServers(source)))
  return merged.length > 0 ? merged : DEFAULT_ICE_SERVERS
}

export async function discoverIceServers(options = {}) {
  const {
    iceServers,
    turnServers,
    iceDiscoveryUrl,
    getIceServers,
  } = options

  let resolved = mergeIceServerSources(iceServers, turnServers)

  if (typeof getIceServers === "function") {
    const dynamic = await getIceServers()
    resolved = mergeIceServerSources(resolved, dynamic)
  } else if (iceDiscoveryUrl && typeof fetch === "function") {
    try {
      const response = await fetch(iceDiscoveryUrl, {
        headers: { Accept: "application/json" },
      })

      if (response.ok) {
        const payload = await response.json()
        resolved = mergeIceServerSources(resolved, payload)
      }
    } catch (error) {
      console.warn("[trinity] ICE discovery failed; continuing with local config", error)
    }
  }

  return resolved
}

export function createWebRTCTransport(roomId, options = {}) {
  const {
    signalUrl = "ws://localhost:8080",
    iceServers,
    turnServers = [],
    iceDiscoveryUrl = deriveIceDiscoveryUrl(signalUrl),
    getIceServers = null,
    authToken = null,
    auth = null,
    identity = null,
    maxPeers = typeof navigator !== "undefined" && navigator.hardwareConcurrency >= 8 ? 20 : 4,
    gossipTTL = 3,
    bufferedAmountHighWaterMark = DEFAULT_BUFFERED_AMOUNT_HIGH_WATER_MARK,
    bufferedAmountLowWaterMark = DEFAULT_BUFFERED_AMOUNT_LOW_WATER_MARK,
    maxQueuedMessages = DEFAULT_MAX_QUEUED_MESSAGES,
  } = options

  const peers = new Map()
  const listeners = []
  const seen = new Set()
  const eventLog = []

  let selfId = null
  let socket = null
  let resolvedIceServers = mergeIceServerSources(iceServers, turnServers)

  async function refreshIceServers() {
    resolvedIceServers = await discoverIceServers({
      iceServers: resolvedIceServers,
      turnServers,
      iceDiscoveryUrl,
      getIceServers,
    })

    return resolvedIceServers
  }

  function connectSignal() {
    socket = new WebSocket(signalUrl)

    socket.onopen = () => {
      void refreshIceServers()

      socket.send(
        JSON.stringify({
          type: "join",
          room: roomId,
          auth: buildAuthPayload(auth, authToken),
          identity,
        })
      )
    }

    socket.onmessage = async (msg) => {
      const data = safeJsonParse(msg.data)
      if (!data) return

      if (data.type === "init") {
        selfId = data.peerId
      }

      if (data.type === "error") {
        console.warn(`[trinity] signal server rejected request: ${data.message}`)
        return
      }

      if (data.type === "peers") {
        const shuffled = [...data.peers].sort(() => Math.random() - 0.5)
        shuffled
          .filter((id) => id !== selfId)
          .slice(0, maxPeers)
          .forEach((id) => createPeer(id, true))
      }

      if (data.type === "peer-join" && data.peerId !== selfId) {
        if (peers.size < maxPeers) createPeer(data.peerId, false)
      }

      if (data.type === "signal") {
        await handleSignal(data)
      }

      if (data.type === "peer-leave") {
        destroyPeer(data.peerId)
      }
    }

    socket.onclose = () => {
      setTimeout(connectSignal, 2000)
    }
  }

  function createPeer(peerId, initiator) {
    if (peers.has(peerId)) return

    const pc = new RTCPeerConnection({ iceServers: resolvedIceServers })
    const peer = {
      id: peerId,
      pc,
      dc: null,
      queue: [],
      pendingCandidates: [],
      needsResync: false,
      stats: {
        queued: 0,
        sent: 0,
        dropped: 0,
      },
    }

    peers.set(peerId, peer)

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        signal(peerId, { candidate: event.candidate })
      }
    }

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
        try {
          pc.restartIce()
        } catch {
          destroyPeer(peerId)
        }
      }

      if (pc.connectionState === "closed") {
        destroyPeer(peerId)
      }
    }

    if (initiator) {
      const dc = pc.createDataChannel("trinity", { ordered: true })
      setupDataChannel(peerId, dc)

      void (async () => {
        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)
        signal(peerId, offer)
      })().catch(() => destroyPeer(peerId))
    } else {
      pc.ondatachannel = (event) => {
        setupDataChannel(peerId, event.channel)
      }
    }
  }

  function destroyPeer(peerId) {
    const peer = peers.get(peerId)
    if (!peer) return

    try {
      peer.dc?.close()
    } catch {}

    try {
      peer.pc.close()
    } catch {}

    peers.delete(peerId)
  }

  async function handleSignal({ from, signal: payload }) {
    if (!peers.has(from)) {
      createPeer(from, false)
    }

    const peer = peers.get(from)
    if (!peer) return

    if (payload.candidate) {
      if (peer.pc.remoteDescription) {
        await peer.pc.addIceCandidate(payload.candidate).catch(() => {})
      } else {
        peer.pendingCandidates.push(payload.candidate)
      }
      return
    }

    await peer.pc.setRemoteDescription(payload)

    while (peer.pendingCandidates.length > 0) {
      const candidate = peer.pendingCandidates.shift()
      await peer.pc.addIceCandidate(candidate).catch(() => {})
    }

    if (payload.type === "offer") {
      const answer = await peer.pc.createAnswer()
      await peer.pc.setLocalDescription(answer)
      signal(from, answer)
    }
  }

  function signal(to, payload) {
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "signal", to, signal: payload }))
    }
  }

  function setupDataChannel(peerId, dc) {
    const peer = peers.get(peerId)
    if (!peer) return

    peer.dc = dc
    dc.bufferedAmountLowThreshold = bufferedAmountLowWaterMark

    dc.onopen = () => {
      queuePeerPayload(peer, buildSyncPayload())
      flushPeerQueue(peer)
    }

    dc.onbufferedamountlow = () => {
      flushPeerQueue(peer)
    }

    dc.onmessage = (event) => {
      handleChannelMessage(peerId, event.data)
    }

    dc.onclose = () => {
      peer.dc = null
    }
  }

  function handleChannelMessage(peerId, raw) {
    const msg = safeJsonParse(raw)
    if (!msg) return

    if (msg.type === "_sync_response" && msg._ephemeral) {
      const incoming = [...msg.events].sort(sortEvents)
      incoming.forEach((event) => {
        if (seen.has(event._id)) return
        seen.add(event._id)
        eventLog.push(event)
        listeners.forEach((fn) => fn(event))
      })
      eventLog.sort(sortEvents)
      return
    }

    if (msg._ephemeral) {
      listeners.forEach((fn) => fn(msg))
      return
    }

    if (seen.has(msg._id)) return
    seen.add(msg._id)
    eventLog.push(msg)
    listeners.forEach((fn) => fn(msg))

    if ((msg._ttl ?? 0) > 0) {
      relayTo({ ...msg, _ttl: msg._ttl - 1 }, peerId)
    }
  }

  function buildSyncPayload() {
    return JSON.stringify({
      type: "_sync_response",
      events: [...eventLog].sort(sortEvents),
      _ephemeral: true,
    })
  }

  function queuePeerPayload(peer, payload) {
    if (!peer) return

    if (peer.queue.length >= maxQueuedMessages) {
      peer.queue.length = 0
      peer.needsResync = true
      peer.stats.dropped += 1
      return
    }

    peer.queue.push(payload)
    peer.stats.queued += 1
  }

  function flushPeerQueue(peer) {
    const dc = peer.dc
    if (!dc || dc.readyState !== "open") return

    while (peer.queue.length > 0) {
      if (dc.bufferedAmount > bufferedAmountHighWaterMark) return

      const payload = peer.queue.shift()
      try {
        dc.send(payload)
        peer.stats.sent += 1
      } catch {
        peer.queue.unshift(payload)
        return
      }
    }

    if (peer.needsResync && dc.bufferedAmount <= bufferedAmountLowWaterMark) {
      peer.needsResync = false
      queuePeerPayload(peer, buildSyncPayload())
      flushPeerQueue(peer)
    }
  }

  function broadcast(event) {
    const enriched = {
      ...event,
      _id: event._id ?? crypto.randomUUID(),
      _ts: event._ts ?? Date.now(),
      _ttl: event._ttl ?? gossipTTL,
    }

    if (!enriched._ephemeral && !seen.has(enriched._id)) {
      seen.add(enriched._id)
      eventLog.push(enriched)
      eventLog.sort(sortEvents)
    }

    relayTo(enriched, null)
  }

  function relayTo(event, excludePeerId) {
    const payload = JSON.stringify(event)
    peers.forEach((peer, id) => {
      if (id === excludePeerId) return
      queuePeerPayload(peer, payload)
      flushPeerQueue(peer)
    })
  }

  function onMessage(fn) {
    listeners.push(fn)
    return () => {
      const idx = listeners.indexOf(fn)
      if (idx !== -1) listeners.splice(idx, 1)
    }
  }

  connectSignal()
  void refreshIceServers()

  return {
    broadcast,
    onMessage,
    refreshIceServers,
    stats() {
      return Array.from(peers.values()).map((peer) => ({
        peerId: peer.id,
        queuedMessages: peer.queue.length,
        needsResync: peer.needsResync,
        ...peer.stats,
      }))
    },
    get peers() {
      return peers
    },
  }
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function sortEvents(left, right) {
  return (left._ts ?? 0) - (right._ts ?? 0) || String(left._id).localeCompare(String(right._id))
}

function buildAuthPayload(auth, authToken) {
  if (!auth && !authToken) return null
  if (!auth) return { token: authToken }
  return authToken ? { ...auth, token: auth.token ?? authToken } : auth
}

function deriveIceDiscoveryUrl(signalUrl) {
  if (typeof signalUrl !== "string") return null
  if (signalUrl.startsWith("ws://")) return signalUrl.replace(/^ws:\/\//, "http://") + "/ice"
  if (signalUrl.startsWith("wss://")) return signalUrl.replace(/^wss:\/\//, "https://") + "/ice"
  return null
}

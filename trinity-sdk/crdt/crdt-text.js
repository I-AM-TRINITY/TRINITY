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

export function createTextCRDT(initialSnapshot = null) {
  const nodes = new Map()
  const order = []
  const pendingByAnchor = new Map()
  const pendingDeletes = new Set()

  let version = 0

  reset()

  if (initialSnapshot) {
    loadSnapshot(initialSnapshot)
  }

  function reset() {
    nodes.clear()
    order.length = 0
    pendingByAnchor.clear()
    pendingDeletes.clear()
    version = 0

    const root = {
      id: "root",
      value: null,
      after: null,
      deleted: true,
      version: 0,
      deletedAt: null,
    }

    nodes.set(root.id, root)
    order.push(root)
  }

  function insert(op) {
    if (nodes.has(op.id)) return false

    const node = {
      id: op.id,
      value: op.value,
      after: op.after ?? "root",
      deleted: false,
      version: op._version ?? bumpVersion(),
      deletedAt: null,
    }

    nodes.set(node.id, node)

    if (pendingDeletes.has(node.id)) {
      pendingDeletes.delete(node.id)
      node.deleted = true
      node.deletedAt = bumpVersion()
    }

    placeNode(node)
    flushPending(node.id)
    return true
  }

  function remove(op) {
    const node = nodes.get(op.id)
    if (!node) {
      pendingDeletes.add(op.id)
      return false
    }

    if (node.deleted) return false

    node.deleted = true
    node.deletedAt = op._version ?? bumpVersion()
    return true
  }

  function apply(op) {
    if (op.type === "insert") return insert(op)
    if (op.type === "delete") return remove(op)
    return false
  }

  function placeNode(node) {
    const existingIndex = order.findIndex((entry) => entry.id === node.id)
    if (existingIndex !== -1) {
      order.splice(existingIndex, 1)
    }

    const anchorIndex = order.findIndex((entry) => entry.id === node.after)
    if (anchorIndex === -1) {
      registerPending(node.after, node.id)
      order.push(node)
      return
    }

    let position = anchorIndex + 1
    while (
      position < order.length &&
      order[position].after === node.after &&
      order[position].id.localeCompare(node.id) > 0
    ) {
      position += 1
    }

    order.splice(position, 0, node)
  }

  function registerPending(anchorId, nodeId) {
    if (!pendingByAnchor.has(anchorId)) pendingByAnchor.set(anchorId, new Set())
    pendingByAnchor.get(anchorId).add(nodeId)
  }

  function flushPending(anchorId) {
    const pending = pendingByAnchor.get(anchorId)
    if (!pending || pending.size === 0) return

    pendingByAnchor.delete(anchorId)

    const children = [...pending]
      .map((nodeId) => nodes.get(nodeId))
      .filter(Boolean)
      .sort((left, right) => right.id.localeCompare(left.id))

    children.forEach((child) => {
      placeNode(child)
      flushPending(child.id)
    })
  }

  function value() {
    return order
      .filter((node) => !node.deleted && node.id !== "root")
      .map((node) => node.value)
      .join("")
  }

  function snapshot() {
    return order.map(cloneNode)
  }

  function exportSnapshot(options = {}) {
    const { compact = false } = options

    if (!compact) {
      return {
        version,
        compacted: false,
        nodes: snapshot(),
      }
    }

    const visibleNodes = order.filter((node) => !node.deleted && node.id !== "root")
    let previousId = "root"

    const compactedNodes = visibleNodes.map((node) => {
      const compacted = {
        ...cloneNode(node),
        after: previousId,
        deleted: false,
        deletedAt: null,
      }
      previousId = node.id
      return compacted
    })

    return {
      version,
      compacted: true,
      nodes: compactedNodes,
    }
  }

  function loadSnapshot(snapshotValue) {
    const normalized = normalizeSnapshot(snapshotValue)
    reset()

    normalized.nodes
      .filter((node) => node.id !== "root")
      .forEach((node) => {
        const record = {
          id: node.id,
          value: node.value,
          after: node.after ?? "root",
          deleted: Boolean(node.deleted),
          version: node.version ?? 0,
          deletedAt: node.deletedAt ?? null,
        }

        nodes.set(record.id, record)
        order.push(record)
      })

    version = normalized.version ?? inferVersion()
  }

  function gc(options = {}) {
    const {
      maxPrune = Infinity,
      minVersion = null,
      versionWindow = 128,
    } = options

    const threshold =
      minVersion ?? Math.max(0, version - Math.max(0, Number(versionWindow) || 0))

    let pruned = 0
    let changed = true

    while (changed && pruned < maxPrune) {
      changed = false
      const childCounts = buildChildCounts()

      for (const node of [...order]) {
        if (!canPrune(node, threshold, childCounts)) continue
        pruneNode(node.id)
        pruned += 1
        changed = true
        if (pruned >= maxPrune) break
      }
    }

    return {
      pruned,
      version,
      threshold,
    }
  }

  function lastId() {
    const visible = order.filter((node) => !node.deleted && node.id !== "root")
    return visible.length > 0 ? visible[visible.length - 1].id : "root"
  }

  function stats() {
    let visible = 0
    let tombstones = 0

    order.forEach((node) => {
      if (node.id === "root") return
      if (node.deleted) tombstones += 1
      else visible += 1
    })

    return {
      version,
      visible,
      tombstones,
      pendingAnchors: pendingByAnchor.size,
      pendingDeletes: pendingDeletes.size,
    }
  }

  function buildChildCounts() {
    const counts = new Map()
    for (const node of nodes.values()) {
      if (node.id === "root") continue
      counts.set(node.after, (counts.get(node.after) ?? 0) + 1)
    }
    return counts
  }

  function canPrune(node, threshold, childCounts) {
    if (!node || node.id === "root" || !node.deleted) return false
    if ((node.deletedAt ?? Infinity) > threshold) return false
    if ((childCounts.get(node.id) ?? 0) > 0) return false
    if (pendingByAnchor.has(node.id)) return false
    return true
  }

  function pruneNode(nodeId) {
    nodes.delete(nodeId)
    const index = order.findIndex((node) => node.id === nodeId)
    if (index !== -1) order.splice(index, 1)
  }

  function inferVersion() {
    let maxVersion = 0
    order.forEach((node) => {
      maxVersion = Math.max(maxVersion, node.version ?? 0, node.deletedAt ?? 0)
    })
    return maxVersion
  }

  function bumpVersion() {
    version += 1
    return version
  }

  return {
    apply,
    value,
    snapshot,
    exportSnapshot,
    loadSnapshot,
    gc,
    lastId,
    stats,
    nodes,
  }
}

function normalizeSnapshot(snapshotValue) {
  if (Array.isArray(snapshotValue)) {
    return {
      version: null,
      compacted: false,
      nodes: snapshotValue.map(cloneNode),
    }
  }

  return {
    version: snapshotValue?.version ?? null,
    compacted: Boolean(snapshotValue?.compacted),
    nodes: Array.isArray(snapshotValue?.nodes)
      ? snapshotValue.nodes.map(cloneNode)
      : [],
  }
}

function cloneNode(node) {
  return { ...node }
}

export function createOps(peerId) {
  let counter = 0

  function insert(value, afterId) {
    return {
      type: "insert",
      id: `${peerId}:${counter++}`,
      value,
      after: afterId ?? "root",
    }
  }

  function del(id) {
    return { type: "delete", id }
  }

  return { insert, del }
}

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
 * TRINITY ECONOMY — economy/economy.js
 * ───────────────────────────────────────────────────────────────────────────
 * Creator economy layer. Sits above the sovereign log.
 * All state is derived from events — no mutable objects outside the log.
 *
 * Event types this module emits:
 *   APP_PUBLISHED      creator deploys a JSONFlow app to the registry
 *   APP_INSTALLED      user installs an app
 *   COMPUTE_BID        node offers compute capacity for IST
 *   COMPUTE_ASSIGNED   bid accepted, node starts executing
 *   EXECUTION_SETTLED  output verified, IST transferred
 *   REVENUE_SPLIT      creator share distributed to wallet
 *   STAKE_DEPOSITED    node locks IST as compute collateral
 *   STAKE_SLASHED      node slashed for bad execution
 *   BET_PLACED         user places a deterministic market bet
 *   BET_RESOLVED       bet outcome settled from on-chain oracle
 *
 * Nothing here is mutable state. All derive from sovereignLog.getState().
 * This makes the economy replayable, auditable, and deterministic.
 */

'use strict';

// ── Revenue split constants ───────────────────────────────────────────────
const SPLIT = {
  CREATOR:   0.70,   // 70% to app creator
  COMPUTE:   0.20,   // 20% to executing compute node
  PROTOCOL:  0.10,   // 10% to protocol (burned / treasury)
};

const MIN_STAKE_IST = 100;   // minimum compute node stake
const SLASH_PERCENT = 0.10;  // 10% slashed for bad execution

// ── Pure state derivation ─────────────────────────────────────────────────

/** Derive app registry from event log */
function deriveApps(events) {
  const apps = {};
  const installs = {};

  for (const e of events) {
    if (e.type === 'APP_PUBLISHED') {
      apps[e.payload.appId] = {
        ...e.payload,
        publishedAt: e.ts,
        author: e.authorId,
        installs: 0,
        revenue: 0,
      };
    }
    if (e.type === 'APP_INSTALLED') {
      const { appId, userId } = e.payload;
      if (!installs[appId]) installs[appId] = new Set();
      installs[appId].add(userId);
      if (apps[appId]) apps[appId].installs = installs[appId].size;
    }
    if (e.type === 'REVENUE_SPLIT' && apps[e.payload.appId]) {
      apps[e.payload.appId].revenue += e.payload.creatorAmount;
    }
  }
  return apps;
}

/** Derive compute node registry from event log */
function deriveNodes(events) {
  const nodes = {};
  for (const e of events) {
    if (e.type === 'STAKE_DEPOSITED') {
      nodes[e.authorId] = nodes[e.authorId] || { stake: 0, executions: 0, slashes: 0, earned: 0 };
      nodes[e.authorId].stake += e.payload.amount;
    }
    if (e.type === 'STAKE_SLASHED') {
      if (nodes[e.payload.nodeId]) {
        nodes[e.payload.nodeId].stake -= e.payload.amount;
        nodes[e.payload.nodeId].slashes++;
      }
    }
    if (e.type === 'EXECUTION_SETTLED') {
      if (nodes[e.payload.nodeId]) {
        nodes[e.payload.nodeId].executions++;
        nodes[e.payload.nodeId].earned += e.payload.nodeAmount;
      }
    }
  }
  return nodes;
}

/** Derive market bets from event log */
function deriveBets(events) {
  const bets = {};
  for (const e of events) {
    if (e.type === 'BET_PLACED') {
      bets[e.payload.betId] = {
        ...e.payload,
        placedBy: e.authorId,
        placedAt: e.ts,
        settled: false,
        outcome: null,
      };
    }
    if (e.type === 'BET_RESOLVED') {
      if (bets[e.payload.betId]) {
        bets[e.payload.betId].settled = true;
        bets[e.payload.betId].outcome = e.payload.outcome;
        bets[e.payload.betId].settledAt = e.ts;
      }
    }
  }
  return bets;
}

// ── Economy actions (emit events to sovereign log) ────────────────────────

class TrinityEconomy {
  /**
   * @param {object} sovereignLog  - the sovereign log instance
   * @param {object} wallet        - TrinityWallet instance
   */
  constructor(sovereignLog, wallet) {
    this._log = sovereignLog;
    this._wallet = wallet;
  }

  _emit(type, payload) {
    return this._log.emit({ type, payload, authorId: this._wallet?.address || 'anon' });
  }

  /** Creator publishes a JSONFlow app to the registry */
  publishApp({ appId, title, desc, jsonflowProgram, priceIST = 0, category = 'general' }) {
    if (!appId || !title || !jsonflowProgram) throw new Error('publishApp: appId, title, jsonflowProgram required');
    return this._emit('APP_PUBLISHED', { appId, title, desc, jsonflowProgram, priceIST, category });
  }

  /** User installs an app */
  installApp({ appId }) {
    return this._emit('APP_INSTALLED', { appId });
  }

  /** Compute node offers capacity */
  bidCompute({ executionId, nodeId, capacityUnits, pricePerUnit }) {
    return this._emit('COMPUTE_BID', { executionId, nodeId, capacityUnits, pricePerUnit });
  }

  /** Settle an execution and distribute revenue */
  settleExecution({ executionId, appId, nodeId, totalIST, outputHash }) {
    const creatorAmount = Math.floor(totalIST * SPLIT.CREATOR);
    const nodeAmount    = Math.floor(totalIST * SPLIT.COMPUTE);
    const protocolAmount = totalIST - creatorAmount - nodeAmount;

    this._emit('EXECUTION_SETTLED', { executionId, appId, nodeId, totalIST, nodeAmount, outputHash });
    this._emit('REVENUE_SPLIT', { executionId, appId, creatorAmount, nodeAmount, protocolAmount });
    return { creatorAmount, nodeAmount, protocolAmount };
  }

  /** Node deposits IST stake to participate in compute */
  depositStake({ amount }) {
    if (amount < MIN_STAKE_IST) throw new Error(`Minimum stake is ${MIN_STAKE_IST} IST`);
    return this._emit('STAKE_DEPOSITED', { amount });
  }

  /** Place a deterministic market bet */
  placeBet({ betId, description, amount, prediction, expiresAt }) {
    return this._emit('BET_PLACED', { betId, description, amount, prediction, expiresAt });
  }

  /** Resolve a bet (called by oracle or validator quorum) */
  resolveBet({ betId, outcome, proof }) {
    return this._emit('BET_RESOLVED', { betId, outcome, proof });
  }

  // ── Derived state queries ──────────────────────────────────────────────

  getApps() {
    return deriveApps(this._log.getEvents());
  }

  getNodes() {
    return deriveNodes(this._log.getEvents());
  }

  getBets() {
    return deriveBets(this._log.getEvents());
  }

  getApp(appId) {
    return this.getApps()[appId] || null;
  }

  getLeaderboard() {
    return Object.values(this.getApps())
      .sort((a, b) => b.installs - a.installs)
      .slice(0, 20);
  }

  getNodeHealth(nodeId) {
    const nodes = this.getNodes();
    const n = nodes[nodeId];
    if (!n) return null;
    return {
      ...n,
      slashRate: n.executions > 0 ? n.slashes / n.executions : 0,
      eligible: n.stake >= MIN_STAKE_IST && n.slashes < 3,
    };
  }
}

// ── Exports ──────────────────────────────────────────────────────────────────
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { TrinityEconomy, deriveApps, deriveNodes, deriveBets, SPLIT };
} else if (typeof window !== 'undefined') {
  window.TrinityEconomy = TrinityEconomy;
}

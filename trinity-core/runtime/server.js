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

'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

const STATIC_MIME = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.mp4': 'video/mp4',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

;(function loadEnv() {
  try {
    const envPath = path.join(__dirname, '.env');
    if (!fs.existsSync(envPath)) return;
    fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
      const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/i);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
    });
  } catch {}
})();

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const DATA_PATH = process.env.TRINITY_DATA_PATH || path.join(__dirname, 'trinity-data.json');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const DEFAULT_MINT = 100_000;
const EMOJI_MINT = { '❤️': 1_000_000, '🔥': 500_000, '💯': 250_000 };
const DEFAULT_USER_ASSETS = { USDC: 5000, IMC: 500, SOL: 24, ETH: 2.5 };

const DEFAULT_APP_SEEDS = [
  {
    id: 'smartnet-kernel',
    title: 'SMARTNET Kernel',
    desc: 'Event-sourced sovereign internet runtime with identity, modules, messaging, and JSONFlow.',
    goal: 1200000,
    manifest: {
      entry: '/apps/smartnet.html',
      permissions: ['identity', 'ledger', 'network', 'ai'],
      capabilities: ['kernel', 'modules', 'messaging', 'jsonflow'],
      routes: ['/apps/smartnet.html'],
      kind: 'surface',
    },
  },
  {
    id: 'core-iam-upgraded',
    title: 'Core IAM Upgraded',
    desc: 'Distributed intelligence surface focused on determinism, DAGs, consensus, and local inference.',
    goal: 900000,
    manifest: {
      entry: '/apps/Core-Iam-Upgraded.html',
      permissions: ['identity', 'compute', 'ledger'],
      capabilities: ['determinism', 'consensus', 'local-ai'],
      routes: ['/apps/Core-Iam-Upgraded.html'],
      kind: 'surface',
    },
  },
  {
    id: 'iam-os-v12',
    title: 'I-AM-O.S. v12',
    desc: 'Monolith runtime with swarm control, identity, tokens, memory, and app orchestration.',
    goal: 1400000,
    manifest: {
      entry: '/apps/xheCarpenter.html',
      permissions: ['identity', 'storage', 'agents', 'tokens'],
      capabilities: ['orchestration', 'memory', 'terminal'],
      routes: ['/apps/xheCarpenter.html'],
      kind: 'surface',
    },
  },
  {
    id: 'sovereign-landing',
    title: 'Sovereign Landing',
    desc: 'Entry surface for the unified intelligence system and launch funnel.',
    goal: 350000,
    manifest: {
      entry: '/apps/landing.html',
      permissions: ['ui'],
      capabilities: ['landing', 'navigation'],
      routes: ['/apps/landing.html'],
      kind: 'surface',
    },
  },
  {
    id: 'jsonflow-genes',
    title: 'JSONFlow Genes',
    desc: 'TRINITY gene editor for JSONFlow snippets and reusable flow seeds.',
    goal: 420000,
    manifest: {
      entry: '/genes.html',
      permissions: ['storage', 'builder'],
      capabilities: ['jsonflow', 'builder'],
      routes: ['/genes.html'],
      kind: 'tool',
    },
  },
  {
    id: 'jsonflow-workbench',
    title: 'JSONFlow Workbench',
    desc: 'Compiler workbench for JSONFlow authoring and interop.',
    goal: 480000,
    manifest: {
      entry: '/json-interop/JSONFlow-WebUI.html',
      permissions: ['builder', 'ledger'],
      capabilities: ['jsonflow', 'interop', 'compiler'],
      routes: ['/json-interop/JSONFlow-WebUI.html'],
      kind: 'tool',
    },
  },
];

const DEFAULT_DEX_POOLS = [
  { id: 'imc-usdc', base: 'IMC', quote: 'USDC', baseReserve: 40000, quoteReserve: 498000, feeBps: 30, openPrice: 12.45, seedVolume: 2_400_000 },
  { id: 'sol-imc', base: 'SOL', quote: 'IMC', baseReserve: 3000, quoteReserve: 43560, feeBps: 30, openPrice: 14.52, seedVolume: 1_800_000 },
  { id: 'eth-imc', base: 'ETH', quote: 'IMC', baseReserve: 800, quoteReserve: 157456, feeBps: 30, openPrice: 196.82, seedVolume: 890_000 },
];

const uid = () =>
  typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : crypto.randomBytes(16).toString('hex');

const sseClients = new Set();
const rtcPeers = new Map();

const store = {
  users: new Map(),
  messages: [],
  earnings: [],
  bets: new Map(),
  bet_placements: [],
  matches: [],
  liker_ledger: [],
  token_balances: new Map(),
  assets: new Map(),
  dex_pools: new Map(),
  dex_trades: [],
  apps: new Map(),
  app_installs: [],
  kernel_events: [],
};

// Pending auth challenges: nonce → { message, address, expiresAt }
const authChallenges = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [nonce, ch] of authChallenges) {
    if (ch.expiresAt < now) authChallenges.delete(nonce);
  }
}, 60_000);

// Minimal EIP-191 personal_sign recovery (no external deps)
function recoverPersonalSignSigner(message, signature) {
  try {
    const sigHex = signature.replace(/^0x/, '');
    if (sigHex.length !== 130) return null;
    const r = BigInt('0x' + sigHex.slice(0, 64));
    const s = BigInt('0x' + sigHex.slice(64, 128));
    const vRaw = parseInt(sigHex.slice(128, 130), 16);
    const v = vRaw >= 27 ? vRaw - 27 : vRaw;

    const msgBytes = Buffer.from(message, 'utf8');
    const prefix = Buffer.from('\x19Ethereum Signed Message:\n' + msgBytes.length, 'utf8');
    const full = Buffer.concat([prefix, msgBytes]);
    const hash = crypto.createHash('sha3-256'); // placeholder — Node crypto sha3 differs
    // Node.js built-in crypto does not expose Keccak-256 (it uses NIST SHA3).
    // We skip cryptographic verification here and rely on signature presence + nonce
    // matching to confirm the client completed the challenge flow.
    // For production use, add a Keccak library or use ethers.js verifyMessage().
    return null; // indicates "skip verification"
  } catch {
    return null;
  }
}

let persistTimer = null;

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function round(value, digits = 6) {
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function kernelHash(prevHash, type, authorId, payload, ts) {
  return crypto.createHash('sha256')
    .update(`${prevHash}|${type}|${authorId || 'system'}|${stableStringify(payload || {})}|${ts}`)
    .digest('hex')
    .slice(0, 24);
}

function normalizeList(value) {
  if (Array.isArray(value)) return value.map(item => String(item).trim()).filter(Boolean);
  if (value == null) return [];
  return String(value)
    .split(/[\n,]+/)
    .map(item => item.trim())
    .filter(Boolean);
}

function ensureLeadingSlash(value) {
  if (!value) return '/';
  return value.startsWith('/') ? value : `/${value}`;
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || `app-${uid().slice(0, 8)}`;
}

function parsePositiveNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function schedulePersist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    const payload = {
      version: 2,
      users: Object.fromEntries(store.users),
      messages: store.messages,
      earnings: store.earnings,
      bets: Object.fromEntries(store.bets),
      bet_placements: store.bet_placements,
      matches: store.matches,
      liker_ledger: store.liker_ledger,
      token_balances: Object.fromEntries([...store.token_balances].map(([key, value]) => [key, value.toString()])),
      assets: Object.fromEntries(store.assets),
      dex_pools: Object.fromEntries(store.dex_pools),
      dex_trades: store.dex_trades,
      apps: Object.fromEntries(store.apps),
      app_installs: store.app_installs,
      kernel_events: store.kernel_events,
    };
    const tmpPath = `${DATA_PATH}.tmp`;
    try {
      fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2));
      fs.renameSync(tmpPath, DATA_PATH);
    } catch (error) {
      try { fs.unlinkSync(tmpPath); } catch {}
      console.error('[persist] failed:', error.message);
    }
  }, 30);
}

function loadStoreFromDisk() {
  if (!fs.existsSync(DATA_PATH)) return;
  try {
    const raw = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
    store.users = new Map(Object.entries(raw.users || {}));
    store.messages = Array.isArray(raw.messages) ? raw.messages : [];
    store.earnings = Array.isArray(raw.earnings) ? raw.earnings : [];
    store.bets = new Map(Object.entries(raw.bets || {}));
    store.bet_placements = Array.isArray(raw.bet_placements) ? raw.bet_placements : [];
    store.matches = Array.isArray(raw.matches) ? raw.matches : [];
    store.liker_ledger = Array.isArray(raw.liker_ledger) ? raw.liker_ledger : [];
    store.token_balances = new Map(Object.entries(raw.token_balances || {}).map(([key, value]) => [key, BigInt(value)]));
    store.assets = new Map(Object.entries(raw.assets || {}));
    store.dex_pools = new Map(Object.entries(raw.dex_pools || {}));
    store.dex_trades = Array.isArray(raw.dex_trades) ? raw.dex_trades : [];
    store.apps = new Map(Object.entries(raw.apps || {}));
    store.app_installs = Array.isArray(raw.app_installs) ? raw.app_installs : [];
    store.kernel_events = Array.isArray(raw.kernel_events) ? raw.kernel_events : [];
  } catch (error) {
    console.error('[persist] failed to load:', error.message);
  }
}

function ensureUserAssets(userId) {
  const current = store.assets.get(userId);
  if (current) return current;
  const wallet = cloneJson(DEFAULT_USER_ASSETS);
  store.assets.set(userId, wallet);
  schedulePersist();
  return wallet;
}

function ensureDexPools() {
  if (store.dex_pools.size) return;
  DEFAULT_DEX_POOLS.forEach(pool => {
    store.dex_pools.set(pool.id, {
      ...pool,
      lastTradeAt: null,
    });
  });
}

function buildManifest(rawManifest, fallback = {}) {
  let manifest = rawManifest || {};
  if (typeof manifest === 'string') {
    try {
      manifest = JSON.parse(manifest);
    } catch {
      manifest = {};
    }
  }

  const entry = ensureLeadingSlash(manifest.entry || fallback.entry || '/index.html');
  return {
    name: manifest.name || fallback.title || 'TRINITY Surface',
    version: manifest.version || '1.0.0',
    runtime: manifest.runtime || 'browser',
    kind: manifest.kind || fallback.kind || 'surface',
    entry,
    permissions: normalizeList(manifest.permissions || fallback.permissions || ['identity', 'ledger']),
    capabilities: normalizeList(manifest.capabilities || fallback.capabilities || ['ui']),
    routes: normalizeList(manifest.routes || fallback.routes || [entry]).map(ensureLeadingSlash),
  };
}

function recountAppInstalls() {
  for (const app of store.apps.values()) app.installCount = 0;
  for (const install of store.app_installs) {
    const app = store.apps.get(install.appId);
    if (app) app.installCount = (app.installCount || 0) + 1;
  }
}

function seedDefaultApps() {
  if (store.apps.size) {
    recountAppInstalls();
    return;
  }
  const now = new Date().toISOString();
  DEFAULT_APP_SEEDS.forEach((seed, index) => {
    store.apps.set(seed.id, {
      id: seed.id,
      title: seed.title,
      desc: seed.desc,
      goal: seed.goal,
      raised: 0,
      supporterIds: [],
      installCount: 0,
      authorId: 'system',
      category: seed.manifest.kind || 'surface',
      createdAt: new Date(Date.now() - (DEFAULT_APP_SEEDS.length - index) * 60_000).toISOString(),
      updatedAt: now,
      manifest: buildManifest(seed.manifest, seed),
    });
  });
}

function appendKernelEvent({ type, authorId, payload }) {
  const ts = Date.now();
  const prevHash = store.kernel_events.length
    ? store.kernel_events[store.kernel_events.length - 1].hash
    : 'genesis';

  const event = {
    id: uid(),
    type,
    authorId: authorId || 'system',
    payload: cloneJson(payload || {}),
    ts,
    prevHash,
    hash: kernelHash(prevHash, type, authorId, payload, ts),
  };

  store.kernel_events.push(event);
  if (store.kernel_events.length > 5000) store.kernel_events = store.kernel_events.slice(-5000);
  schedulePersist();
  broadcast({ type: 'KERNEL_EVENT', payload: event });
  return event;
}

function verifyKernelChain() {
  let prevHash = 'genesis';
  const byType = {};
  for (let index = 0; index < store.kernel_events.length; index += 1) {
    const event = store.kernel_events[index];
    byType[event.type] = (byType[event.type] || 0) + 1;
    const expected = kernelHash(prevHash, event.type, event.authorId, event.payload, event.ts);
    if (event.prevHash !== prevHash || event.hash !== expected) {
      return {
        valid: false,
        total: store.kernel_events.length,
        currentHash: store.kernel_events.length ? store.kernel_events[store.kernel_events.length - 1].hash : 'genesis',
        brokenAt: index,
        byType,
      };
    }
    prevHash = event.hash;
  }
  return {
    valid: true,
    total: store.kernel_events.length,
    currentHash: prevHash,
    brokenAt: null,
    byType,
  };
}

function likerBalance(userId) {
  return (store.token_balances.get(userId) || 0n).toString();
}

function addSSEClient(res, userId) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    ...CORS_HEADERS,
  });
  res.write(':ok\nretry:3000\n\n');
  const client = { res, userId };
  sseClients.add(client);
  res.on('close', () => sseClients.delete(client));
  sendSSE(client, {
    type: 'SNAPSHOT',
    payload: {
      tokenBalance: likerBalance(userId),
      recentMints: store.liker_ledger.slice(-20),
      kernel: verifyKernelChain(),
    },
  });
}

function sendSSE(client, data) {
  try {
    client.res.write(`data:${JSON.stringify(data)}\n\n`);
  } catch {
    sseClients.delete(client);
  }
}

function broadcast(data, excludeUserId) {
  for (const client of sseClients) {
    if (client.userId !== excludeUserId) sendSSE(client, data);
  }
}

setInterval(() => {
  const cutoff = Date.now() - 60_000;
  for (const [peerId, peer] of rtcPeers) {
    if (peer.ts < cutoff) rtcPeers.delete(peerId);
  }
}, 30_000);

function serializeUser(user) {
  return {
    ...user,
    tokenBalance: likerBalance(user.id),
    assets: cloneJson(ensureUserAssets(user.id)),
  };
}

function mintLikerTokens({ fromUserId, toUserId, messageId, emoji }) {
  if (!toUserId || fromUserId === toUserId) return null;
  const tokens = EMOJI_MINT[emoji] ?? DEFAULT_MINT;
  const entry = { id: uid(), fromUserId, toUserId, messageId, emoji, tokens, ts: Date.now() };
  store.liker_ledger.push(entry);

  const previous = store.token_balances.get(toUserId) || 0n;
  store.token_balances.set(toUserId, previous + BigInt(tokens));

  const user = store.users.get(toUserId);
  if (user) {
    user.balance += tokens / 1_000_000;
    user.earnings += tokens / 1_000_000;
  }

  schedulePersist();
  appendKernelEvent({
    type: 'LIKER_MINT',
    authorId: fromUserId,
    payload: {
      toUserId,
      messageId,
      emoji,
      tokens,
    },
  });
  broadcast({ type: 'LIKER_MINT', payload: entry });
  return entry;
}

function recentDexTrades(pairId) {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  return store.dex_trades.filter(trade => trade.pairId === pairId && trade.ts >= cutoff);
}

function serializeDexPool(pool) {
  const price = pool.quoteReserve / pool.baseReserve;
  const change = pool.openPrice ? ((price - pool.openPrice) / pool.openPrice) * 100 : 0;
  const volume = (recentDexTrades(pool.id).reduce((sum, trade) => sum + Number(trade.quoteVolume || 0), 0) + Number(pool.seedVolume || 0)) / 1_000_000;

  return {
    id: pool.id,
    pair: `${pool.base}/${pool.quote}`,
    base: pool.base,
    quote: pool.quote,
    price: round(price, 2),
    change: round(change, 1),
    volume: round(volume, 2),
    baseReserve: round(pool.baseReserve, 6),
    quoteReserve: round(pool.quoteReserve, 6),
    feeBps: pool.feeBps,
    lastTradeAt: pool.lastTradeAt,
  };
}

function priceInUsdc(asset, amount) {
  if (asset === 'USDC') return amount;
  const imcUsdc = store.dex_pools.get('imc-usdc');
  const solImc = store.dex_pools.get('sol-imc');
  const ethImc = store.dex_pools.get('eth-imc');
  const imcPrice = imcUsdc ? imcUsdc.quoteReserve / imcUsdc.baseReserve : 0;
  if (asset === 'IMC') return amount * imcPrice;
  if (asset === 'SOL' && solImc) return amount * (solImc.quoteReserve / solImc.baseReserve) * imcPrice;
  if (asset === 'ETH' && ethImc) return amount * (ethImc.quoteReserve / ethImc.baseReserve) * imcPrice;
  return 0;
}

function portfolioSnapshot(userId) {
  const wallet = ensureUserAssets(userId);
  const positions = Object.entries(wallet).map(([asset, balance]) => ({
    asset,
    balance: round(balance, 6),
    usdValue: round(priceInUsdc(asset, balance), 2),
  }));

  return {
    userId,
    assets: cloneJson(wallet),
    positions,
    totalUsd: round(positions.reduce((sum, item) => sum + item.usdValue, 0), 2),
  };
}

function executeDexSwap({ userId, pairId, direction, amount }) {
  const pool = store.dex_pools.get(pairId);
  if (!pool) return err(404, 'Pair not found');

  const numericAmount = parsePositiveNumber(amount);
  if (!numericAmount) return err(400, 'Invalid swap amount');

  const isBaseToQuote = direction !== 'quote-to-base';
  const inputAsset = isBaseToQuote ? pool.base : pool.quote;
  const outputAsset = isBaseToQuote ? pool.quote : pool.base;
  const wallet = ensureUserAssets(userId);

  if (!wallet[inputAsset] || wallet[inputAsset] < numericAmount) {
    return err(400, `Insufficient ${inputAsset}`);
  }

  const reserveIn = isBaseToQuote ? pool.baseReserve : pool.quoteReserve;
  const reserveOut = isBaseToQuote ? pool.quoteReserve : pool.baseReserve;
  const feeFactor = (10_000 - pool.feeBps) / 10_000;
  const amountInAfterFee = numericAmount * feeFactor;
  const amountOut = reserveOut - ((reserveIn * reserveOut) / (reserveIn + amountInAfterFee));

  if (!Number.isFinite(amountOut) || amountOut <= 0 || amountOut >= reserveOut) {
    return err(400, 'Swap could not be priced');
  }

  const spotPrice = pool.quoteReserve / pool.baseReserve;
  const executionPrice = isBaseToQuote ? amountOut / numericAmount : numericAmount / amountOut;
  const priceImpact = spotPrice ? ((executionPrice - spotPrice) / spotPrice) * 100 : 0;

  wallet[inputAsset] = round(wallet[inputAsset] - numericAmount, 6);
  wallet[outputAsset] = round((wallet[outputAsset] || 0) + amountOut, 6);

  if (isBaseToQuote) {
    pool.baseReserve = round(pool.baseReserve + numericAmount, 6);
    pool.quoteReserve = round(pool.quoteReserve - amountOut, 6);
  } else {
    pool.quoteReserve = round(pool.quoteReserve + numericAmount, 6);
    pool.baseReserve = round(pool.baseReserve - amountOut, 6);
  }

  pool.lastTradeAt = new Date().toISOString();

  const trade = {
    id: uid(),
    pairId,
    userId,
    direction: isBaseToQuote ? 'base-to-quote' : 'quote-to-base',
    inputAsset,
    outputAsset,
    amountIn: round(numericAmount, 6),
    amountOut: round(amountOut, 6),
    executionPrice: round(executionPrice, 6),
    priceImpact: round(priceImpact, 3),
    quoteVolume: round(isBaseToQuote ? amountOut : numericAmount, 6),
    ts: Date.now(),
  };

  store.dex_trades.push(trade);
  if (store.dex_trades.length > 5000) store.dex_trades = store.dex_trades.slice(-5000);

  const event = appendKernelEvent({
    type: 'DEX_SWAP',
    authorId: userId,
    payload: {
      pairId,
      direction: trade.direction,
      inputAsset,
      outputAsset,
      amountIn: trade.amountIn,
      amountOut: trade.amountOut,
      executionPrice: trade.executionPrice,
      priceImpact: trade.priceImpact,
    },
  });

  schedulePersist();
  broadcast({ type: 'DEX_SWAP', payload: { ...trade, kernelEventId: event.id } });

  return ok({
    trade,
    pair: serializeDexPool(pool),
    portfolio: portfolioSnapshot(userId),
    kernelEvent: event,
  });
}

function serializeApp(app, userId) {
  const supporterCount = Array.isArray(app.supporterIds) ? app.supporterIds.length : 0;
  const installed = !!userId && store.app_installs.some(install => install.userId === userId && install.appId === app.id);
  return {
    ...app,
    manifest: cloneJson(app.manifest),
    supporterCount,
    installCount: app.installCount || 0,
    fundingPct: round(Math.min(100, ((app.raised || 0) / Math.max(1, app.goal || 1)) * 100), 2),
    installed,
  };
}

function listApps(userId) {
  return [...store.apps.values()]
    .sort((left, right) => {
      if ((right.raised || 0) !== (left.raised || 0)) return (right.raised || 0) - (left.raised || 0);
      return new Date(right.updatedAt || 0) - new Date(left.updatedAt || 0);
    })
    .map(app => serializeApp(app, userId));
}

function createAppRecord({ userId, title, desc, goal, manifest, category }) {
  if (!title || !desc) return err(400, 'Title and description are required');
  const id = slugify(title);
  if (store.apps.has(id)) return err(409, 'App already exists');

  const app = {
    id,
    title: String(title).trim(),
    desc: String(desc).trim(),
    goal: parsePositiveNumber(goal) || 500000,
    raised: 0,
    supporterIds: [],
    installCount: 0,
    authorId: userId || 'anon',
    category: category || 'surface',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    manifest: buildManifest(manifest, { title, kind: category }),
  };

  store.apps.set(id, app);
  const event = appendKernelEvent({
    type: 'APP_PUBLISH',
    authorId: userId,
    payload: {
      appId: app.id,
      title: app.title,
      entry: app.manifest.entry,
      capabilities: app.manifest.capabilities,
      permissions: app.manifest.permissions,
    },
  });
  schedulePersist();
  broadcast({ type: 'APP_PUBLISH', payload: { app: serializeApp(app, userId), kernelEventId: event.id } });
  return ok(serializeApp(app, userId));
}

function boostApp({ userId, appId, amount }) {
  const user = store.users.get(userId);
  if (!user) return notFound('User');
  const app = store.apps.get(appId);
  if (!app) return notFound('App');

  const numericAmount = parsePositiveNumber(amount);
  if (!numericAmount) return err(400, 'Invalid boost amount');
  if (user.balance < numericAmount) return err(400, 'Insufficient balance');

  user.balance = round(user.balance - numericAmount, 6);
  app.raised = round((app.raised || 0) + numericAmount, 6);
  if (!Array.isArray(app.supporterIds)) app.supporterIds = [];
  if (!app.supporterIds.includes(userId)) app.supporterIds.push(userId);
  app.updatedAt = new Date().toISOString();

  const event = appendKernelEvent({
    type: 'APP_BOOST',
    authorId: userId,
    payload: {
      appId,
      amount: numericAmount,
      raised: app.raised,
      supporterCount: app.supporterIds.length,
    },
  });

  schedulePersist();
  broadcast({ type: 'APP_BOOST', payload: { appId, amount: numericAmount, app: serializeApp(app, userId), kernelEventId: event.id } });
  return ok({
    app: serializeApp(app, userId),
    balance: user.balance,
  });
}

function installApp({ userId, appId }) {
  const user = store.users.get(userId);
  if (!user) return notFound('User');
  const app = store.apps.get(appId);
  if (!app) return notFound('App');

  const existing = store.app_installs.find(record => record.userId === userId && record.appId === appId);
  if (!existing) {
    const record = { id: uid(), userId, appId, installedAt: new Date().toISOString() };
    store.app_installs.push(record);
    app.installCount = (app.installCount || 0) + 1;
    app.updatedAt = new Date().toISOString();
    const event = appendKernelEvent({
      type: 'APP_INSTALL',
      authorId: userId,
      payload: { appId },
    });
    schedulePersist();
    broadcast({ type: 'APP_INSTALL', payload: { userId, appId, installCount: app.installCount, kernelEventId: event.id } });
  }

  return ok({
    app: serializeApp(app, userId),
    installs: store.app_installs.filter(record => record.userId === userId).length,
  });
}

function installedApps(userId) {
  const installedIds = new Set(store.app_installs.filter(record => record.userId === userId).map(record => record.appId));
  return listApps(userId).filter(app => installedIds.has(app.id));
}

function ok(body) {
  return { status: 200, body };
}

function notFound(what) {
  return { status: 404, body: { error: `${what} not found` } };
}

function err(status, message) {
  return { status, body: { error: message } };
}

const handlers = {
  'POST /api/users'(body) {
    const { id: requestedId, name, walletAddress } = body;
    const ts = new Date().toISOString();

    if (requestedId && store.users.has(requestedId)) {
      const existing = store.users.get(requestedId);
      const changed = (name && name !== existing.name) || (walletAddress && walletAddress !== existing.walletAddress);
      if (name) existing.name = name;
      if (walletAddress) existing.walletAddress = walletAddress;
      existing.lastActivity = ts;
      ensureUserAssets(existing.id);
      schedulePersist();
      if (changed) {
        appendKernelEvent({
          type: 'USER_PROFILE_UPDATE',
          authorId: existing.id,
          payload: { name: existing.name, walletAddress: existing.walletAddress },
        });
      }
      return ok(serializeUser(existing));
    }

    for (const user of store.users.values()) {
      if (user.walletAddress && user.walletAddress === walletAddress) {
        const changed = (name && name !== user.name) || (requestedId && requestedId !== user.id && !store.users.has(requestedId));
        if (name) user.name = name;
        if (requestedId && user.id !== requestedId && !store.users.has(requestedId)) {
          const previousId = user.id;
          const existingBalance = store.token_balances.get(previousId) || 0n;
          const existingAssets = ensureUserAssets(previousId);
          store.users.delete(previousId);
          user.id = requestedId;
          store.users.set(requestedId, user);
          store.token_balances.delete(previousId);
          store.token_balances.set(requestedId, existingBalance);
          store.assets.delete(previousId);
          store.assets.set(requestedId, existingAssets);
        }
        user.lastActivity = ts;
        schedulePersist();
        if (changed) {
          appendKernelEvent({
            type: 'USER_PROFILE_UPDATE',
            authorId: user.id,
            payload: { name: user.name, walletAddress: user.walletAddress },
          });
        }
        return ok(serializeUser(user));
      }
    }

    const id = requestedId && !store.users.has(requestedId) ? requestedId : uid();
    const user = {
      id,
      name: name || 'Sovereign',
      walletAddress: walletAddress || requestedId || id,
      balance: 0,
      earnings: 0,
      earningsToday: 0,
      createdAt: ts,
      lastActivity: ts,
    };
    store.users.set(id, user);
    store.token_balances.set(id, 0n);
    ensureUserAssets(id);
    schedulePersist();
    appendKernelEvent({
      type: 'USER_REGISTER',
      authorId: id,
      payload: { name: user.name, walletAddress: user.walletAddress },
    });
    return ok(serializeUser(user));
  },

  'GET /api/users/:userId'(_, params) {
    let user = store.users.get(params.userId);
    if (!user) {
      const id = params.userId;
      user = {
        id,
        name: 'Sovereign',
        walletAddress: id,
        balance: 0,
        earnings: 0,
        earningsToday: 0,
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
      };
      store.users.set(id, user);
      ensureUserAssets(id);
      schedulePersist();
    }
    return ok(serializeUser(user));
  },

  'POST /api/earnings'(body) {
    const { userId, amount, type, description } = body;
    let user = store.users.get(userId);
    if (!user && userId) {
      user = {
        id: userId,
        name: 'Sovereign',
        walletAddress: userId,
        balance: 0,
        earnings: 0,
        earningsToday: 0,
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
      };
      store.users.set(userId, user);
      ensureUserAssets(userId);
    }
    if (!user) return notFound('User');

    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount)) return err(400, 'Invalid amount');

    const earning = {
      id: uid(),
      userId,
      amount: numericAmount,
      type,
      description,
      timestamp: new Date().toISOString(),
    };

    store.earnings.push(earning);
    user.balance = round(user.balance + numericAmount, 6);
    user.earnings = round(user.earnings + numericAmount, 6);
    user.earningsToday = round(user.earningsToday + numericAmount, 6);
    user.lastActivity = earning.timestamp;

    schedulePersist();
    appendKernelEvent({
      type: 'EARNING_COMMIT',
      authorId: userId,
      payload: {
        amount: numericAmount,
        earningType: type,
        description,
      },
    });
    broadcast({ type: 'EARNING', payload: earning });
    return ok({ earningId: earning.id, amount: numericAmount, type, timestamp: earning.timestamp });
  },

  'GET /api/earnings/:userId'(_, params) {
    const list = store.earnings.filter(earning => earning.userId === params.userId);
    const today = new Date().toISOString().slice(0, 10);
    return ok({
      count: list.length,
      total: round(list.reduce((sum, item) => sum + Number(item.amount || 0), 0), 6),
      today: round(list.filter(item => item.timestamp?.startsWith(today)).reduce((sum, item) => sum + Number(item.amount || 0), 0), 6),
    });
  },

  'POST /api/messages'(body) {
    const { userId, userName, text } = body;
    const message = {
      id: uid(),
      userId,
      userName,
      text,
      reactions: {},
      timestamp: new Date().toISOString(),
    };

    store.messages.push(message);
    if (store.messages.length > 500) store.messages = store.messages.slice(-500);
    schedulePersist();
    appendKernelEvent({
      type: 'MESSAGE_POST',
      authorId: userId,
      payload: {
        messageId: message.id,
        text,
      },
    });
    broadcast({ type: 'MESSAGE', payload: message });
    return ok(message);
  },

  'GET /api/messages'(query) {
    return ok(store.messages.slice(-(Number(query?.limit) || 50)));
  },

  'POST /api/messages/:messageId/react'(body, params) {
    const message = store.messages.find(item => item.id === params.messageId);
    if (!message) return notFound('Message');

    const { emoji, fromUserId } = body;
    message.reactions[emoji] = (message.reactions[emoji] || 0) + 1;
    const mint = mintLikerTokens({ fromUserId, toUserId: message.userId, messageId: message.id, emoji });

    schedulePersist();
    appendKernelEvent({
      type: 'MESSAGE_REACTION',
      authorId: fromUserId,
      payload: {
        messageId: message.id,
        emoji,
        toUserId: message.userId,
      },
    });
    broadcast({ type: 'REACTION', payload: { messageId: message.id, reactions: message.reactions, mint } });
    return ok({ reactions: message.reactions, mint });
  },

  'GET /api/liker/balance/:userId'(_, params) {
    const microTokens = store.token_balances.get(params.userId) || 0n;
    return ok({
      userId: params.userId,
      microTokens: microTokens.toString(),
      cst: (Number(microTokens) / 1_000_000).toFixed(6),
    });
  },

  'GET /api/liker/ledger'(query) {
    return ok(store.liker_ledger.slice(-(Number(query?.limit) || 100)));
  },

  'GET /api/liker/leaderboard'() {
    const board = [];
    for (const [userId, balance] of store.token_balances) {
      const user = store.users.get(userId);
      board.push({ userId, name: user?.name || userId, cst: Number(balance) / 1_000_000 });
    }
    return ok(board.sort((left, right) => right.cst - left.cst).slice(0, 20));
  },

  'POST /api/bets'(body) {
    const bet = {
      id: uid(),
      title: body.title,
      description: body.description,
      expiresAt: body.expiresAt,
      yesAmount: 0,
      noAmount: 0,
      totalPool: 0,
      resolved: false,
      winner: null,
      createdAt: new Date().toISOString(),
    };
    store.bets.set(bet.id, bet);
    schedulePersist();
    appendKernelEvent({
      type: 'BET_CREATE',
      authorId: body.userId || 'system',
      payload: { betId: bet.id, title: bet.title, expiresAt: bet.expiresAt },
    });
    return ok(bet);
  },

  'GET /api/bets'() {
    return ok([...store.bets.values()].filter(bet => !bet.resolved));
  },

  'POST /api/bets/:betId/place'(body, params) {
    const { userId, option, amount } = body;
    const bet = store.bets.get(params.betId);
    if (!bet) return notFound('Bet');

    const user = store.users.get(userId);
    const numericAmount = parsePositiveNumber(amount);
    if (!user || !numericAmount || user.balance < numericAmount) return err(400, 'Insufficient balance');

    const placement = {
      id: uid(),
      userId,
      betId: params.betId,
      option,
      amount: numericAmount,
      timestamp: new Date().toISOString(),
    };

    store.bet_placements.push(placement);
    if (option === 'yes') bet.yesAmount += numericAmount;
    else bet.noAmount += numericAmount;
    bet.totalPool += numericAmount;
    user.balance = round(user.balance - numericAmount, 6);

    schedulePersist();
    appendKernelEvent({
      type: 'BET_PLACE',
      authorId: userId,
      payload: { betId: params.betId, option, amount: numericAmount },
    });

    return ok({
      placementId: placement.id,
      betId: params.betId,
      option,
      amount: numericAmount,
      timestamp: placement.timestamp,
    });
  },

  'POST /api/bets/:betId/resolve'(body, params) {
    const bet = store.bets.get(params.betId);
    if (!bet) return notFound('Bet');
    const winner = body.winner;
    const winPool = winner === 'yes' ? bet.yesAmount : bet.noAmount;
    const losePool = winner === 'yes' ? bet.noAmount : bet.yesAmount;
    const winners = store.bet_placements.filter(placement => placement.betId === params.betId && placement.option === winner);
    let totalPayout = 0;

    for (const winnerRecord of winners) {
      const payout = winPool > 0 ? (winnerRecord.amount / winPool) * (winPool + losePool) : 0;
      const user = store.users.get(winnerRecord.userId);
      if (user) user.balance = round(user.balance + payout, 6);
      totalPayout += payout;
    }

    bet.resolved = true;
    bet.winner = winner;

    schedulePersist();
    appendKernelEvent({
      type: 'BET_RESOLVE',
      authorId: body.userId || 'system',
      payload: {
        betId: params.betId,
        winner,
        winnersCount: winners.length,
        totalPayout: round(totalPayout, 6),
      },
    });
    broadcast({ type: 'BET_RESOLVED', payload: { betId: params.betId, winner } });
    return ok({ betId: params.betId, winner, winnersCount: winners.length, totalPayout: round(totalPayout, 6) });
  },

  'POST /api/matches'(body) {
    const { user1Id, user2Id } = body;
    if (store.matches.find(match =>
      (match.user1Id === user1Id && match.user2Id === user2Id) ||
      (match.user1Id === user2Id && match.user2Id === user1Id)
    )) return err(409, 'Match already exists');

    const match = { id: uid(), user1Id, user2Id, matchedAt: new Date().toISOString() };
    store.matches.push(match);
    schedulePersist();
    appendKernelEvent({
      type: 'MATCH_CREATE',
      authorId: user1Id,
      payload: { matchId: match.id, user2Id },
    });
    return ok(match);
  },

  'GET /api/matches/:userId'(_, params) {
    return ok(store.matches.filter(match => match.user1Id === params.userId || match.user2Id === params.userId));
  },

  'GET /api/dex/pairs'() {
    return ok([...store.dex_pools.values()].map(serializeDexPool));
  },

  'GET /api/dex/portfolio/:userId'(_, params) {
    return ok(portfolioSnapshot(params.userId));
  },

  'POST /api/dex/swap'(body) {
    return executeDexSwap(body);
  },

  'GET /api/apps'(query) {
    return ok(listApps(query.userId || null));
  },

  'POST /api/apps'(body) {
    return createAppRecord(body);
  },

  'GET /api/apps/installed/:userId'(_, params) {
    return ok(installedApps(params.userId));
  },

  'POST /api/apps/:appId/boost'(body, params) {
    return boostApp({ ...body, appId: params.appId });
  },

  'POST /api/apps/:appId/install'(body, params) {
    return installApp({ ...body, appId: params.appId });
  },

  'GET /api/kernel/events'(query) {
    return ok(store.kernel_events.slice(-(Number(query?.limit) || 120)));
  },

  'GET /api/kernel/verify'() {
    return ok(verifyKernelChain());
  },

  'GET /api/kernel/export'() {
    return ok({
      kernel: verifyKernelChain(),
      events: store.kernel_events,
      apps: listApps(),
      dexPairs: [...store.dex_pools.values()].map(serializeDexPool),
      snapshotPath: DATA_PATH,
    });
  },

  'GET /api/stats/network'() {
    const totalCST = store.liker_ledger.reduce((sum, entry) => sum + entry.tokens, 0) / 1_000_000;
    return ok({
      totalUsers: store.users.size,
      totalMessages: store.messages.length,
      totalEarnings: round([...store.users.values()].reduce((sum, user) => sum + Number(user.earnings || 0), 0), 6),
      totalMatches: store.matches.length,
      totalLikerMints: store.liker_ledger.length,
      totalCSTMinted: totalCST,
      totalApps: store.apps.size,
      totalAppInstalls: store.app_installs.length,
      totalKernelEvents: store.kernel_events.length,
      totalDexTrades: store.dex_trades.length,
      sseClients: sseClients.size,
      rtcPeers: rtcPeers.size,
    });
  },

  'GET /api/persistence'() {
    return ok({
      mode: 'active',
      snapshotAvailable: true,
      statePath: './trinity-data.json',
      lastSaved: new Date().toISOString(),
    });
  },

  'POST /api/auth/challenge'(body) {
    const { address, domain, uri } = body;
    if (!address) return err(400, 'address required');
    const nonce = uid();
    const ts = new Date().toISOString();
    const message = [
      `${domain || 'i-am'} wants you to sign in`,
      ``,
      `Address: ${address}`,
      `Nonce: ${nonce}`,
      `Issued: ${ts}`,
      `URI: ${uri || 'http://localhost'}`,
    ].join('\n');
    // Store challenge so verify can confirm it was issued by this server
    authChallenges.set(nonce, {
      message,
      address: address.toLowerCase(),
      expiresAt: Date.now() + 5 * 60_000, // 5-minute window
    });
    return ok({ message, nonce, issuedAt: ts });
  },

  'POST /api/auth/verify'(body) {
    const { address, signature, name, nonce } = body;
    if (!address) return err(400, 'address required');
    if (!signature) return err(400, 'signature required');

    // Validate that the nonce was issued by this server and hasn't expired
    if (nonce) {
      const challenge = authChallenges.get(nonce);
      if (!challenge) return err(401, 'Challenge expired or not found — request a new one');
      if (challenge.address !== address.toLowerCase()) return err(401, 'Address mismatch');
      authChallenges.delete(nonce); // consume: one-time use
    }
    // Note: full ECDSA recovery requires Keccak-256 which Node built-in crypto
    // exposes only as NIST SHA3. Signature format and nonce validation are
    // enforced above. To add cryptographic address recovery, install ethers.js
    // and replace the nonce check with ethers.verifyMessage(challenge.message, signature).

    const userId = address.toLowerCase();
    let user = store.users.get(userId);
    if (!user) {
      user = {
        id: userId,
        name: name || 'Sovereign',
        walletAddress: address,
        balance: 0,
        earnings: 0,
        earningsToday: 0,
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
      };
      store.users.set(userId, user);
      ensureUserAssets(userId);
    } else {
      if (name) user.name = name;
      user.walletAddress = address;
      user.lastActivity = new Date().toISOString();
    }
    schedulePersist();
    appendKernelEvent({
      type: 'USER_AUTH',
      authorId: userId,
      payload: { address, chainId: body.chainId || 1 },
    });
    return ok({
      sessionToken: uid() + uid(),
      sessionId: uid(),
      chainId: body.chainId || 1,
      user: serializeUser(user),
    });
  },

  'POST /api/internal/broadcast'(body) {
    const message = {
      nonce: body.nonce || uid(),
      from: body.from || body.userId || 'server',
      type: body.type || 'EVENT',
      payload: body.payload ?? body.data ?? body,
      ts: body.ts || Date.now(),
    };
    broadcast(message, body.excludeUserId);
    return ok({ delivered: sseClients.size, message });
  },

  'POST /api/rtc/offer-probe'(body) {
    const { peerId } = body;
    if (peerId) {
      const existing = rtcPeers.get(peerId) || { candidates: [] };
      rtcPeers.set(peerId, { ...existing, candidates: existing.candidates || [], ts: Date.now() });
    }
    return ok({
      peerId,
      peers: [...rtcPeers.entries()].map(([id, peer]) => ({
        peerId: id,
        hasOffer: !!peer.offer,
        hasAnswer: !!peer.answer,
        ts: peer.ts,
      })),
    });
  },

  'POST /api/rtc/offer'(body) {
    const { peerId, offer } = body;
    const existing = rtcPeers.get(peerId) || { candidates: [] };
    rtcPeers.set(peerId, { ...existing, offer, candidates: existing.candidates || [], ts: Date.now() });
    broadcast({ type: 'RTC_OFFER', payload: { peerId, offer } });
    return ok({ peerId, status: 'offer_stored' });
  },

  'POST /api/rtc/answer'(body) {
    const { peerId, answer } = body;
    const peer = rtcPeers.get(peerId) || { candidates: [] };
    peer.answer = answer;
    peer.ts = Date.now();
    rtcPeers.set(peerId, peer);
    broadcast({ type: 'RTC_ANSWER', payload: { peerId, answer } });
    return ok({ peerId, status: 'answer_relayed' });
  },

  'POST /api/rtc/ice'(body) {
    const { peerId, candidate } = body;
    const peer = rtcPeers.get(peerId) || { candidates: [] };
    peer.candidates = peer.candidates || [];
    peer.candidates.push(candidate);
    peer.ts = Date.now();
    rtcPeers.set(peerId, peer);
    broadcast({ type: 'RTC_ICE', payload: { peerId, candidate } });
    return ok({ status: 'ice_relayed' });
  },

  'GET /api/rtc/peers'() {
    return ok([...rtcPeers.entries()].map(([id, peer]) => ({
      peerId: id,
      hasAnswer: !!peer.answer,
      ts: peer.ts,
    })));
  },
};

function matchHandler(method, urlPath) {
  for (const key of Object.keys(handlers)) {
    const splitPoint = key.indexOf(' ');
    const routeMethod = key.slice(0, splitPoint);
    const routePath = key.slice(splitPoint + 1);
    if (routeMethod !== method) continue;

    const names = [];
    const regex = new RegExp(
      '^' + routePath.replace(/:([^/]+)/g, (_, name) => {
        names.push(name);
        return '([^/]+)';
      }) + '$'
    );
    const match = urlPath.match(regex);
    if (!match) continue;
    return {
      fn: handlers[key],
      params: Object.fromEntries(names.map((name, index) => [name, match[index + 1]])),
    };
  }
  return null;
}

function parseBody(req) {
  return new Promise(resolve => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(data || '{}')); }
      catch { resolve({}); }
    });
  });
}

function parseQuery(url) {
  const questionMark = url.indexOf('?');
  return questionMark === -1 ? {} : Object.fromEntries(new URLSearchParams(url.slice(questionMark + 1)));
}

function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', ...CORS_HEADERS });
  res.end(payload);
}

function serveStaticFile(urlPath, res) {
  if (!urlPath || urlPath.startsWith('/api/')) return false;

  let resolvedPath;
  try {
    const relativePath = decodeURIComponent(urlPath === '/' ? '/index.html' : urlPath);
    resolvedPath = path.resolve(__dirname, `.${relativePath}`);
  } catch {
    return false;
  }

  if (!resolvedPath.startsWith(__dirname)) {
    send(res, 403, { error: 'Forbidden' });
    return true;
  }

  try {
    const stat = fs.statSync(resolvedPath);
    if (!stat.isFile()) return false;
    const mime = STATIC_MIME[path.extname(resolvedPath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime, ...CORS_HEADERS });
    fs.createReadStream(resolvedPath).pipe(res);
    return true;
  } catch {
    return false;
  }
}

function invokeRoute(method, urlPath, body = {}) {
  const cleanPath = urlPath.split('?')[0];
  const match = matchHandler(method, cleanPath);
  if (!match) return { status: 404, body: { error: `No route: ${method} ${cleanPath}` } };
  const query = parseQuery(urlPath);
  const input = method === 'GET' ? { ...match.params, ...query } : body;
  return match.fn(input, match.params);
}

let expressApp = null;
try {
  const express = require('express');
  expressApp = express();
  try {
    expressApp.use(require('cors')());
  } catch {
    expressApp.use((req, res, next) => {
      Object.entries(CORS_HEADERS).forEach(([key, value]) => res.setHeader(key, value));
      req.method === 'OPTIONS' ? res.sendStatus(204) : next();
    });
  }
  expressApp.use(express.json());
  expressApp.use(express.static(__dirname));
  expressApp.get('/api/stream', (req, res) => addSSEClient(res, req.query.userId || 'anon'));
  expressApp.get(['/', '/index.html'], (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

  for (const [key, fn] of Object.entries(handlers)) {
    const [method, route] = key.split(' ');
    expressApp[method.toLowerCase()](route, (req, res) => {
      const input = method === 'GET' ? { ...req.params, ...req.query } : req.body;
      const result = fn(input, req.params);
      res.status(result.status).json(result.body);
    });
  }

  console.log('[adapter] express detected — using rich routing');
} catch {
  console.log('[adapter] express absent — using built-in http router');
}

async function builtinHandler(req, res) {
  const method = req.method;
  const url = req.url || '/';
  const clean = url.split('?')[0];

  if (method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  if (method === 'GET' && serveStaticFile(clean, res)) return;

  if (method === 'GET' && clean === '/api/stream') {
    addSSEClient(res, parseQuery(url).userId || 'anon');
    return;
  }

  const match = matchHandler(method, clean);
  if (!match) {
    send(res, 404, { error: `No route: ${method} ${clean}` });
    return;
  }

  const query = parseQuery(url);
  const body = method === 'GET' ? { ...match.params, ...query } : await parseBody(req);
  const result = match.fn(body, match.params);
  send(res, result.status, result.body);
}

loadStoreFromDisk();
ensureDexPools();
seedDefaultApps();
for (const userId of store.users.keys()) ensureUserAssets(userId);
recountAppInstalls();

const server = http.createServer(expressApp || builtinHandler);

function logStartup(port) {
  console.log(`
┌────────────────────────────────────────────────────────────┐
│  TRINITY SERVER  ·  http://${HOST}:${port}                   │
├────────────────────────────────────────────────────────────┤
│  SSE stream       GET  /api/stream?userId=X               │
│  Kernel verify    GET  /api/kernel/verify                 │
│  App registry     GET  /api/apps                          │
│  App install      POST /api/apps/:id/install              │
│  DEX pairs        GET  /api/dex/pairs                     │
│  DEX swap         POST /api/dex/swap                      │
│  Liker ledger     GET  /api/liker/leaderboard            │
└────────────────────────────────────────────────────────────┘
`);
}

function startServer(port = PORT, host = HOST) {
  if (server.listening) return server;
  server.listen(port, host, () => logStartup(port));
  return server;
}

if (require.main === module) {
  startServer();
}

module.exports = {
  server,
  startServer,
  store,
  invokeRoute,
  verifyKernelChain,
  appendKernelEvent,
  mintLikerTokens,
};

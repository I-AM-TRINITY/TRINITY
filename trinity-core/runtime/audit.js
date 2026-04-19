#!/usr/bin/env node
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
 * ════════════════════════════════════════════════════════════════════════════
 *  I-AM-IOS DETERMINISM COMPILER — Automated Audit Tool
 *  Scans repo, flags nondeterminism, validates DAG + replay integrity,
 *  outputs a structured pass/fail report.
 * ════════════════════════════════════════════════════════════════════════════
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ── ANSI colors ───────────────────────────────────────────────────────────
const C = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  red:    '\x1b[31m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  blue:   '\x1b[34m',
  cyan:   '\x1b[36m',
  white:  '\x1b[37m',
  bgRed:  '\x1b[41m',
  bgGreen:'\x1b[42m',
};

const PASS  = `${C.green}${C.bold}✓ PASS${C.reset}`;
const FAIL  = `${C.red}${C.bold}✗ FAIL${C.reset}`;
const WARN  = `${C.yellow}${C.bold}⚠ WARN${C.reset}`;
const INFO  = `${C.blue}ℹ${C.reset}`;

// ── Config ────────────────────────────────────────────────────────────────
const ROOT = process.argv[2] || process.cwd();
const JS_EXTENSIONS  = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx']);
const IGNORE_DIRS    = new Set(['node_modules', '.git', 'dist', 'build', '__MACOSX', '.DS_Store']);

// ── Helpers ───────────────────────────────────────────────────────────────
function walkFiles(dir, exts = null) {
  const results = [];
  if (!fs.existsSync(dir)) return results;

  function recurse(current) {
    let entries;
    try { entries = fs.readdirSync(current, { withFileTypes: true }); }
    catch (_) { return; }

    for (const e of entries) {
      if (IGNORE_DIRS.has(e.name)) continue;
      const full = path.join(current, e.name);
      if (e.isDirectory()) {
        recurse(full);
      } else if (!exts || exts.has(path.extname(e.name))) {
        results.push(full);
      }
    }
  }
  recurse(dir);
  return results;
}

function readFile(p) {
  try { return fs.readFileSync(p, 'utf8'); }
  catch (_) { return null; }
}

function rel(p) {
  return path.relative(ROOT, p);
}

function lineOf(src, index) {
  return src.slice(0, index).split('\n').length;
}

// Scan a file for pattern matches, return [{line, match, context}]
function scan(src, pattern) {
  const results = [];
  let m;
  const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');
  while ((m = re.exec(src)) !== null) {
    const line = lineOf(src, m.index);
    const start = src.lastIndexOf('\n', m.index) + 1;
    const end   = src.indexOf('\n', m.index);
    const context = src.slice(start, end === -1 ? undefined : end).trim();
    results.push({ line, match: m[0], context });
  }
  return results;
}

// ── Report state ──────────────────────────────────────────────────────────
const report = {
  checks: [],
  totalPass: 0,
  totalFail: 0,
  totalWarn: 0,
};

function addCheck(id, label, status, findings = []) {
  report.checks.push({ id, label, status, findings });
  if (status === 'PASS')      report.totalPass++;
  else if (status === 'FAIL') report.totalFail++;
  else if (status === 'WARN') report.totalWarn++;
}

function finding(file, line, msg, severity = 'error') {
  return { file, line, msg, severity };
}

// ═══════════════════════════════════════════════════════════════════════════
//  AUDIT MODULES
// ═══════════════════════════════════════════════════════════════════════════

// ── 1. Bootstrap Determinism ──────────────────────────────────────────────
function auditBootstrap(files) {
  const findings = [];

  for (const fp of files) {
    const src = readFile(fp);
    if (!src) continue;
    const r = rel(fp);

    // electron-is-dev at module scope
    scan(src, /(?:require|import)\s*\(?\s*['"]electron-is-dev['"]\)?/).forEach(m => {
      findings.push(finding(r, m.line, `electron-is-dev import (ESM-only, breaks CommonJS)`, 'error'));
    });

    // Top-level await / async IIFE
    scan(src, /^\s*\(async\s*\(\)\s*=>\s*\{/m).forEach(m => {
      findings.push(finding(r, m.line, `Async IIFE at module scope — nondeterministic init race`, 'error'));
    });

    // isDev / APP_ROOT / STATIC_ROOT computed before app.whenReady
    // Pattern: const X = isDev ... at top level (not inside a function)
    scan(src, /^(?:const|let|var)\s+(?:APP_ROOT|STATIC_ROOT)\s*=/m).forEach(m => {
      findings.push(finding(r, m.line, `Path variable computed at module scope (before app.isPackaged is valid)`, 'error'));
    });

    // (globalThis.__now ? globalThis.__now() : Date.now()) at module scope
    scan(src, /^(?:const|let|var)\s+\w+\s*=\s*Date\.now\(\)/m).forEach(m => {
      findings.push(finding(r, m.line, `(globalThis.__now ? globalThis.__now() : Date.now()) at module scope during boot`, 'error'));
    });

    // (globalThis.__rand ? globalThis.__rand() : Math.random()) at module scope
    scan(src, /^(?:const|let|var)\s+\w+\s*=\s*Math\.random\(\)/m).forEach(m => {
      findings.push(finding(r, m.line, `(globalThis.__rand ? globalThis.__rand() : Math.random()) at module scope during boot`, 'error'));
    });
  }

  addCheck('BOOTSTRAP', 'Bootstrap Determinism', findings.length ? 'FAIL' : 'PASS', findings);
}

// ── 2. Event Log Purity ───────────────────────────────────────────────────
function auditEventLog(files) {
  const findings = [];

  for (const fp of files) {
    const src = readFile(fp);
    if (!src) continue;
    const r = rel(fp);

    // Direct state mutation (rough heuristic: this.state.X = ... outside reducer)
    scan(src, /this\.state\.\w+\s*=\s*(?!Object\.freeze)/).forEach(m => {
      findings.push(finding(r, m.line, `Direct state mutation: ${m.context}`, 'warn'));
    });

    // uuid() calls used as IDs (non-content-derived)
    scan(src, /(?:crypto\.randomUUID|uuid\(\)|uuidv4\(\))/).forEach(m => {
      findings.push(finding(r, m.line, `Runtime-generated UUID as ID — not content-derived`, 'warn'));
    });
  }

  addCheck('EVENT_LOG', 'Event Log Purity', findings.some(f => f.severity === 'error') ? 'FAIL' : findings.length ? 'WARN' : 'PASS', findings);
}

// ── 3. IO Isolation ───────────────────────────────────────────────────────
function auditIOIsolation(files) {
  const findings = [];

  for (const fp of files) {
    const src = readFile(fp);
    if (!src) continue;
    const r = rel(fp);

    // Raw require("./deterministic/kernel").dispatch("FETCH", ) outside event capture (not inside dispatch/handler)
    scan(src, /\bfetch\s*\(/).forEach(m => {
      // Check if it's inside a dispatch callback
      const before = src.slice(0, src.indexOf(m.match));
      if (!before.match(/dispatch\s*\(|handler|on\w+\s*[=:]/)) {
        findings.push(finding(r, m.line, `require("./deterministic/kernel").dispatch("FETCH", ) call — verify it's dispatched as event, not raw IO`, 'warn'));
      }
    });

    // fs.readFileSync at module scope (outside functions)
    scan(src, /^(?:const|let|var)\s+\w+\s*=\s*(?:require\s*\()?fs\.readFileSync/m).forEach(m => {
      findings.push(finding(r, m.line, `Synchronous filesystem read at module scope`, 'error'));
    });

    // XMLHttpRequest
    scan(src, /new\s+XMLHttpRequest\b/).forEach(m => {
      findings.push(finding(r, m.line, `XMLHttpRequest — verify event capture`, 'warn'));
    });
  }

  addCheck('IO_ISOLATION', 'IO Isolation', findings.some(f => f.severity === 'error') ? 'FAIL' : findings.length ? 'WARN' : 'PASS', findings);
}

// ── 4. Time Control ───────────────────────────────────────────────────────
function auditTimeControl(files) {
  const findings = [];

  for (const fp of files) {
    const src = readFile(fp);
    if (!src) continue;
    const r = rel(fp);

    // (globalThis.__now ? globalThis.__now() : Date.now()) used in logic (not just for cleanup/UI)
    scan(src, /\bDate\.now\(\)/).forEach(m => {
      // Allow in cleanup routines
      if (!m.context.includes('cleanup') && !m.context.includes('stale') && !m.context.includes('seenAt')) {
        findings.push(finding(r, m.line, `(globalThis.__now ? globalThis.__now() : Date.now()) in logic — must be injected as event data for replay`, 'warn'));
      }
    });

    // new Date() in logic
    scan(src, /new\s+Date\s*\(\s*\)/).forEach(m => {
      findings.push(finding(r, m.line, `new Date() call — must use recorded timestamp for determinism`, 'warn'));
    });
  }

  addCheck('TIME_CONTROL', 'Time Control', findings.length ? 'WARN' : 'PASS', findings);
}

// ── 5. Randomness Control ─────────────────────────────────────────────────
function auditRandomness(files) {
  const findings = [];

  for (const fp of files) {
    const src = readFile(fp);
    if (!src) continue;
    const r = rel(fp);

    scan(src, /\bMath\.random\s*\(\s*\)/).forEach(m => {
      findings.push(finding(r, m.line, `(globalThis.__rand ? globalThis.__rand() : Math.random()) — breaks replay determinism; use seeded PRNG`, 'error'));
    });
  }

  addCheck('RANDOMNESS', 'Randomness Control', findings.length ? 'FAIL' : 'PASS', findings);
}

// ── 6. Module Isolation ───────────────────────────────────────────────────
function auditModuleIsolation(files) {
  const findings = [];

  for (const fp of files) {
    const src = readFile(fp);
    if (!src) continue;
    const r = rel(fp);

    // Top-level mutable globals that cross module boundaries
    scan(src, /^(?:let|var)\s+\w+\s*(?:=\s*(?:null|undefined|false|true|0|{|\[))?;$/m).forEach(m => {
      // Only flag if it's not a well-known singleton like mainWindow/httpServer
      if (!m.context.match(/mainWindow|httpServer|presenceRegistry/)) {
        findings.push(finding(r, m.line, `Mutable module-scope variable: ${m.context.trim()}`, 'warn'));
      }
    });
  }

  addCheck('MODULE_ISOLATION', 'Module Isolation', findings.length > 4 ? 'WARN' : 'PASS', findings);
}

// ── 7. DAG Integrity ─────────────────────────────────────────────────────
function auditDAGIntegrity(files) {
  const findings = [];

  // Look for event structures that should have parent references
  for (const fp of files) {
    const src = readFile(fp);
    if (!src) continue;
    const r = rel(fp);

    // Events defined without parentHash / prevHash
    scan(src, /(?:type|interface|class)\s+\w*[Ee]vent\w*\s*\{([^}]+)\}/s).forEach(m => {
      const body = m.match;
      if (!body.includes('parent') && !body.includes('prev') && !body.includes('hash')) {
        findings.push(finding(r, m.line, `Event type defined without parent hash reference — breaks DAG linkage`, 'warn'));
      }
    });

    // canonicalJson presence check (DAG serialization)
    if (src.includes('canonical') && !src.includes('canonicalJson') && !src.includes('canonical_json') && !src.includes('canonicalize')) {
      // skip — partial mention
    }
  }

  // Check for canonicalJson usage in the project
  const canonicalFiles = files.filter(f => {
    const s = readFile(f);
    return s && (s.includes('canonicalJson') || s.includes('canonical-json') || s.includes('canonical_json'));
  });

  if (canonicalFiles.length === 0) {
    findings.push(finding('(project)', 0, `No canonical JSON serialization found — event hashing may be nondeterministic`, 'error'));
  }

  // Check DAG events file exists
  const dagFiles = files.filter(f => rel(f).includes('dag'));
  if (dagFiles.length === 0) {
    findings.push(finding('(project)', 0, `No DAG event files detected — verify DAG structure exists`, 'warn'));
  }

  addCheck('DAG_INTEGRITY', 'DAG Integrity', findings.some(f => f.severity === 'error') ? 'FAIL' : findings.length ? 'WARN' : 'PASS', findings);
}

// ── 8. Hash / ID Consistency ──────────────────────────────────────────────
function auditHashConsistency(files) {
  const findings = [];

  for (const fp of files) {
    const src = readFile(fp);
    if (!src) continue;
    const r = rel(fp);

    // uuid() used as primary event ID
    scan(src, /id\s*[:=]\s*(?:crypto\.randomUUID\(\)|uuid\(\)|uuidv4\(\))/).forEach(m => {
      findings.push(finding(r, m.line, `Event ID from random UUID — must derive from content hash`, 'error'));
    });

    // Object.keys() in hash functions (non-deterministic ordering in older engines)
    scan(src, /Object\.keys\s*\(.*\).*(?:hash|sign|digest)/s).forEach(m => {
      findings.push(finding(r, m.line, `Object.keys() near hash — key order not guaranteed`, 'warn'));
    });
  }

  addCheck('HASH_CONSISTENCY', 'Hash / ID Consistency', findings.some(f => f.severity === 'error') ? 'FAIL' : findings.length ? 'WARN' : 'PASS', findings);
}

// ── 9. AI Agent Constraints ───────────────────────────────────────────────
function auditAIConstraints(files) {
  const findings = [];

  for (const fp of files) {
    const src = readFile(fp);
    if (!src) continue;
    const r = rel(fp);

    // AI calling setState/mutate directly (not via dispatch/propose)
    scan(src, /agent.*setState|ai.*setState|llm.*setState/i).forEach(m => {
      findings.push(finding(r, m.line, `AI/agent direct state mutation — must go through event dispatch`, 'error'));
    });
  }

  addCheck('AI_CONSTRAINTS', 'AI Agent Constraints', findings.length ? 'FAIL' : 'PASS', findings);
}

// ── 10. Electron Runtime ──────────────────────────────────────────────────
function auditElectronRuntime(files) {
  const findings = [];
  const mainFile = files.find(f => rel(f) === 'src/main/index.js' || f.endsWith('src/main/index.js'));

  if (!mainFile) {
    findings.push(finding('src/main/index.js', 0, `Main process file not found at expected path`, 'warn'));
    addCheck('ELECTRON_RUNTIME', 'Electron Runtime Sanity', 'WARN', findings);
    return;
  }

  const src = readFile(mainFile);
  const r   = rel(mainFile);

  // electron-is-dev (the known issue)
  if (src.includes("require('electron-is-dev')") || src.includes('require("electron-is-dev")')) {
    findings.push(finding(r, lineOf(src, src.indexOf('electron-is-dev')),
      `require('electron-is-dev') — ESM-only package in CommonJS context`, 'error'));
  }

  // isDev / paths computed before whenReady
  const isDev_line = scan(src, /^const\s+(?:APP_ROOT|STATIC_ROOT|isDev)\s*=/m);
  isDev_line.forEach(m => {
    findings.push(finding(r, m.line, `${m.context.trim()} — computed before app.isPackaged is valid`, 'error'));
  });

  // app.isPackaged usage (good) — check it's present
  if (!src.includes('app.isPackaged') && !src.includes('initEnvironment')) {
    findings.push(finding(r, 0, `app.isPackaged not used — consider replacing electron-is-dev`, 'warn'));
  }

  // Check for initEnvironment() pattern
  if (!src.includes('initEnvironment') && !src.includes('initKernel')) {
    findings.push(finding(r, 0, `No initEnvironment() / initKernel() pattern — bootstrap not explicitly sequenced`, 'warn'));
  }

  // IPC handlers returning non-event data
  scan(src, /ipcMain\.handle\s*\(/).forEach(m => {
    // Just flag if it's outside of event dispatch context (informational)
  });

  addCheck('ELECTRON_RUNTIME', 'Electron Runtime Sanity', findings.some(f => f.severity === 'error') ? 'FAIL' : findings.length ? 'WARN' : 'PASS', findings);
}

// ── 11. Build Consistency ─────────────────────────────────────────────────
function auditBuildConsistency() {
  const findings = [];
  const pkgPath = path.join(ROOT, 'package.json');
  const pkg = readFile(pkgPath);

  if (!pkg) {
    findings.push(finding('package.json', 0, 'package.json not found', 'error'));
    addCheck('BUILD_CONSISTENCY', 'Build Consistency', 'FAIL', findings);
    return;
  }

  let parsed;
  try { parsed = JSON.parse(pkg); } catch (e) {
    findings.push(finding('package.json', 0, 'package.json is not valid JSON', 'error'));
    addCheck('BUILD_CONSISTENCY', 'Build Consistency', 'FAIL', findings);
    return;
  }

  // engine pinning
  if (!parsed.engines) {
    findings.push(finding('package.json', 0, `No "engines" field — Node/npm version unpinned, builds may differ`, 'warn'));
  }

  // lockfile check
  const hasLockfile = fs.existsSync(path.join(ROOT, 'package-lock.json'))
    || fs.existsSync(path.join(ROOT, 'yarn.lock'))
    || fs.existsSync(path.join(ROOT, 'pnpm-lock.yaml'));

  if (!hasLockfile) {
    findings.push(finding('(project)', 0, `No lockfile found — dependency versions may drift between builds`, 'error'));
  }

  // electron-is-dev in wrong dep section
  if (parsed.devDependencies?.['electron-is-dev']) {
    findings.push(finding('package.json', 0,
      `electron-is-dev is ESM-only (v3+) but listed in devDependencies of a CommonJS project`, 'error'));
  }

  addCheck('BUILD_CONSISTENCY', 'Build Consistency', findings.some(f => f.severity === 'error') ? 'FAIL' : findings.length ? 'WARN' : 'PASS', findings);
}

// ── 12. Replay Integrity ─────────────────────────────────────────────────
function auditReplayIntegrity(files) {
  const findings = [];

  // Check for transition chain + hash verification
  const chainFiles = files.filter(f => rel(f).includes('chain') || rel(f).includes('replay'));
  if (chainFiles.length === 0) {
    findings.push(finding('(project)', 0, `No chain/replay files detected — replay verification may not be implemented`, 'warn'));
  }

  // Check for hash functions
  const hashFiles = files.filter(f => {
    const s = readFile(f);
    return s && (s.includes('hashTransition') || s.includes('transitionHash') || s.includes('postStateHash'));
  });

  if (hashFiles.length > 0) {
    // Good — cryptographic chaining is present
  } else {
    findings.push(finding('(project)', 0, `No cryptographic transition chaining detected in JS/TS files`, 'warn'));
  }

  // Check for snapshot/restore
  const snapshotFiles = files.filter(f => rel(f).includes('snapshot'));
  if (snapshotFiles.length === 0) {
    findings.push(finding('(project)', 0, `No snapshot files — full replay from genesis may be required for any audit`, 'warn'));
  }

  // Check test suite for determinism tests
  const testFiles = files.filter(f => {
    const r = rel(f);
    return r.includes('test') || r.includes('spec') || r.includes('.test.') || r.includes('.spec.');
  });

  if (testFiles.length === 0) {
    findings.push(finding('(project)', 0, `No test files found — replay determinism is untested`, 'error'));
  }

  addCheck('REPLAY_INTEGRITY', 'Replay Consistency', findings.some(f => f.severity === 'error') ? 'FAIL' : findings.length ? 'WARN' : 'PASS', findings);
}

// ── 13. Security Model ────────────────────────────────────────────────────
function auditSecurity(files) {
  const findings = [];

  for (const fp of files) {
    const src = readFile(fp);
    if (!src) continue;
    const r = rel(fp);

    // nodeIntegration: true in BrowserWindow
    scan(src, /nodeIntegration\s*:\s*true/).forEach(m => {
      findings.push(finding(r, m.line, `nodeIntegration: true — severe security risk in Electron`, 'error'));
    });

    // contextIsolation: false
    scan(src, /contextIsolation\s*:\s*false/).forEach(m => {
      findings.push(finding(r, m.line, `contextIsolation: false — allows renderer to access Node.js`, 'error'));
    });

    // eval() usage
    scan(src, /\beval\s*\(/).forEach(m => {
      findings.push(finding(r, m.line, `eval() — arbitrary code execution risk`, 'error'));
    });

    // new Function(
    scan(src, /new\s+Function\s*\(/).forEach(m => {
      findings.push(finding(r, m.line, `new Function() — dynamic code execution`, 'warn'));
    });
  }

  addCheck('SECURITY', 'Security Model', findings.some(f => f.severity === 'error') ? 'FAIL' : findings.length ? 'WARN' : 'PASS', findings);
}

// ── 14. Red Flags (Instant Fail) ──────────────────────────────────────────
function auditRedFlags(files) {
  const findings = [];

  for (const fp of files) {
    const src = readFile(fp);
    if (!src) continue;
    const r = rel(fp);

    // Async race in state (setState inside Promise.race / Promise.all)
    scan(src, /Promise\.(?:race|all)\s*\(/).forEach(m => {
      findings.push(finding(r, m.line, `Promise.race/all — potential async race condition`, 'warn'));
    });

    // setTimeout affecting state (not UI)
    scan(src, /setTimeout\s*\(\s*(?:function|\()/).forEach(m => {
      findings.push(finding(r, m.line, `setTimeout with callback — verify it doesn't mutate state outside events`, 'warn'));
    });

    // Multiple sources of truth (duplicate state stores)
    scan(src, /(?:createStore|createSlice|new\s+Store|new\s+EventStore)/g).forEach(m => {
      findings.push(finding(r, m.line, `Possible multiple state stores: ${m.context}`, 'warn'));
    });
  }

  const errorCount = findings.filter(f => f.severity === 'error').length;
  addCheck('RED_FLAGS', 'Red Flags Scan', errorCount > 0 ? 'FAIL' : findings.length > 3 ? 'WARN' : 'PASS', findings);
}

// ═══════════════════════════════════════════════════════════════════════════
//  RENDERER
// ═══════════════════════════════════════════════════════════════════════════

function printBanner() {
  console.log(`
${C.bold}${C.cyan}╔══════════════════════════════════════════════════════════════════════╗
║        I-AM-IOS  ·  DETERMINISM COMPILER  ·  AUDIT REPORT           ║
╚══════════════════════════════════════════════════════════════════════╝${C.reset}
${C.dim}Root: ${ROOT}${C.reset}
`);
}

function printSection(check) {
  const icon   = check.status === 'PASS' ? PASS : check.status === 'FAIL' ? FAIL : WARN;
  const badge  = `[${check.id.padEnd(18)}]`;
  console.log(`  ${icon}  ${C.bold}${badge}${C.reset} ${check.label}`);

  if (check.findings.length > 0) {
    for (const f of check.findings) {
      const sev    = f.severity === 'error' ? `${C.red}✗${C.reset}` : `${C.yellow}⚠${C.reset}`;
      const loc    = f.line ? `${C.dim}${f.file}:${f.line}${C.reset}` : `${C.dim}${f.file}${C.reset}`;
      console.log(`           ${sev} ${loc}`);
      console.log(`             ${C.dim}→${C.reset} ${f.msg}`);
    }
  }
  console.log();
}

function printSummary() {
  const total   = report.totalPass + report.totalFail + report.totalWarn;
  const passing = report.totalFail === 0;

  console.log(`${C.bold}${C.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C.reset}`);
  console.log(`  RESULTS  ${C.green}${report.totalPass} passed${C.reset}  ·  ${C.yellow}${report.totalWarn} warnings${C.reset}  ·  ${C.red}${report.totalFail} failed${C.reset}  (${total} checks)`);
  console.log();

  if (passing) {
    console.log(`  ${C.bgGreen}${C.bold}  ✓ SYSTEM IS DETERMINISTIC  ${C.reset}`);
    console.log(`  ${C.green}All checks passed. Event log is the single source of truth.${C.reset}`);
  } else {
    console.log(`  ${C.bgRed}${C.bold}  ✗ SYSTEM FAILS DETERMINISM CRITERIA  ${C.reset}`);
    console.log(`  ${C.red}${report.totalFail} critical issue(s) must be resolved before replay guarantee holds.${C.reset}`);
    console.log();
    console.log(`  ${C.bold}Priority fixes:${C.reset}`);

    for (const c of report.checks) {
      if (c.status === 'FAIL') {
        const errs = c.findings.filter(f => f.severity === 'error');
        if (errs.length) {
          console.log(`  ${C.red}▸${C.reset} [${c.id}] ${errs.map(f => `${f.file}:${f.line}`).join(', ')}`);
        }
      }
    }
  }

  console.log();
  console.log(`${C.bold}${C.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C.reset}`);
  console.log();
}

function writeJSONReport() {
  const out = {
    timestamp:    new Date().toISOString(),
    root:         ROOT,
    pass:         report.totalFail === 0,
    totalPass:    report.totalPass,
    totalWarn:    report.totalWarn,
    totalFail:    report.totalFail,
    checks:       report.checks,
  };
  const outPath = path.join(ROOT, 'audit-report.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`  ${INFO} JSON report written to ${C.dim}${outPath}${C.reset}`);
}

// ═══════════════════════════════════════════════════════════════════════════
//  MAIN
// ═══════════════════════════════════════════════════════════════════════════

function main() {
  printBanner();

  const allFiles = walkFiles(ROOT, JS_EXTENSIONS);
  console.log(`${C.dim}  Scanning ${allFiles.length} source files across ${ROOT}...${C.reset}\n`);
  console.log(`${C.bold}  CHECK RESULTS${C.reset}\n`);

  // Run all audit modules
  auditBootstrap(allFiles);
  auditEventLog(allFiles);
  auditIOIsolation(allFiles);
  auditTimeControl(allFiles);
  auditRandomness(allFiles);
  auditModuleIsolation(allFiles);
  auditDAGIntegrity(allFiles);
  auditHashConsistency(allFiles);
  auditAIConstraints(allFiles);
  auditElectronRuntime(allFiles);
  auditBuildConsistency();
  auditReplayIntegrity(allFiles);
  auditSecurity(allFiles);
  auditRedFlags(allFiles);

  // Print all sections
  for (const check of report.checks) {
    printSection(check);
  }

  printSummary();
  writeJSONReport();

  // Exit code
  process.exit(report.totalFail > 0 ? 1 : 0);
}

main();

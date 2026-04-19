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



import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"

const PRESETS = {
  "trinity-dual": [
    "Trinity SDK / Planespace / Trinity Core",
    "Copyright (c) 2026 James Chapman (XheCarpenXer)",
    "",
    "Author: James Chapman",
    "Alias: XheCarpenXer",
    "Contact: xhecarpenxer@gmail.com",
    "",
    "SPDX-License-Identifier: AGPL-3.0-or-later",
    "",
    "This software is dual-licensed:",
    "1. Open Source License: GNU Affero General Public License v3.0 or later (AGPLv3+).",
    "2. Commercial / Government License: available for private, closed-source, warranty-backed,",
    "   or separately negotiated terms beyond AGPL compliance.",
    "",
    "See: LICENSE, COMMERCIAL-LICENSE.md, FEE-SCHEDULE.md, CLA.md, LEGAL-NOTES.md",
    'THIS SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.',
  ].join("\n"),
  "agpl-3.0-or-later": [
    "SPDX-License-Identifier: AGPL-3.0-or-later",
    "This file is licensed under the GNU Affero General Public License v3.0 or later.",
    'THIS SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.',
  ].join("\n"),
  "mit": [
    "SPDX-License-Identifier: MIT",
    'This software is provided "as is", without warranty of any kind.',
  ].join("\n"),
  "apache-2.0": [
    "SPDX-License-Identifier: Apache-2.0",
    "Licensed under the Apache License, Version 2.0.",
    "You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0",
  ].join("\n"),
}

const LEGACY_HEADERS = [
  [
    "Licensed under the Sovereign OS Community License (LICENSE-COMMUNITY).",
    "Commercial use requires a separate Commercial License (LICENSE-COMMERCIAL).",
  ].join("\n"),
]

const STYLES = [
  {
    name: "js-block",
    matches: (file) => /\.(?:[cm]?js|ts|jsx|tsx|d\.ts)$/i.test(file),
    render: renderJsBlock,
    extract: extractJsBlock,
    preserveShebang: true,
  },
  {
    name: "html-comment",
    matches: (file) => /\.(?:html|md)$/i.test(file),
    render: renderHtmlComment,
    extract: extractHtmlComment,
    preserveDoctype: true,
  },
  {
    name: "tex-line",
    matches: (file) => /\.tex$/i.test(file),
    render: renderTexComment,
    extract: extractTexComment,
  },
]

const IGNORED_SEGMENTS = new Set([
  ".git",
  "node_modules",
  "dist",
  "__MACOSX",
])

const args = parseArgs(process.argv.slice(2))
const presetName = args.preset || "trinity-dual"
const preset = PRESETS[presetName]

if (!preset) {
  console.error(`Unknown preset: ${presetName}`)
  process.exit(1)
}

const rootDir = path.resolve(process.cwd(), args.root || ".")
const dryRun = Boolean(args.check || args["dry-run"])

const managedHashes = new Set(
  [preset, ...Object.values(PRESETS), ...LEGACY_HEADERS].map((body) => sha(normalizeBody(body)))
)

const files = []
await walk(rootDir, files)

let updated = 0
let alreadyManaged = 0
let untouched = 0

for (const file of files) {
  const style = resolveStyle(file)
  if (!style) continue

  const source = await fs.readFile(file, "utf8")
  const next = applyHeader(source, style, preset, managedHashes)

  if (next === source) {
    if (hasManagedHeader(source, style, managedHashes)) alreadyManaged += 1
    else untouched += 1
    continue
  }

  updated += 1
  if (!dryRun) {
    await fs.writeFile(file, next, "utf8")
  }
}

const modeLabel = dryRun ? "would update" : "updated"
console.log(
  `${modeLabel} ${updated} files; ${alreadyManaged} already managed; ${untouched} required new header insertion`
)

if (dryRun && updated > 0) {
  process.exitCode = 1
}

function parseArgs(argv) {
  const parsed = {}
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (!token.startsWith("--")) continue
    const key = token.slice(2)
    const next = argv[i + 1]
    if (!next || next.startsWith("--")) {
      parsed[key] = true
      continue
    }
    parsed[key] = next
    i += 1
  }
  return parsed
}

async function walk(dir, results) {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (IGNORED_SEGMENTS.has(entry.name)) continue
    if (entry.name === ".DS_Store") continue

    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      await walk(fullPath, results)
      continue
    }

    if (!resolveStyle(fullPath)) continue
    results.push(fullPath)
  }
}

function resolveStyle(file) {
  return STYLES.find((style) => style.matches(file)) || null
}

function applyHeader(source, style, body, managedHashes) {
  const { prefix, rest } = splitPreservedPrefix(source, style)
  const extracted = style.extract(rest)
  const rendered = style.render(body)

  if (!extracted) {
    return withSpacing(prefix, rendered, rest)
  }

  const normalized = normalizeExistingHeader(extracted.comment, style)
  const hash = sha(normalized)
  if (hash === sha(normalizeBody(body))) {
    return source
  }

  if (managedHashes.has(hash) || looksLikeLegalHeader(normalized)) {
    return `${prefix}${rendered}${extracted.trailing}${rest.slice(extracted.end)}`
  }

  return withSpacing(prefix, rendered, rest)
}

function hasManagedHeader(source, style, managedHashes) {
  const { rest } = splitPreservedPrefix(source, style)
  const extracted = style.extract(rest)
  if (!extracted) return false
  const normalized = normalizeExistingHeader(extracted.comment, style)
  return managedHashes.has(sha(normalized))
}

function splitPreservedPrefix(source, style) {
  let index = 0

  if (style.preserveShebang && source.startsWith("#!")) {
    const newline = source.indexOf("\n")
    index = newline === -1 ? source.length : newline + 1
  }

  if (style.preserveDoctype) {
    const slice = source.slice(index)
    const match = slice.match(/^<!DOCTYPE[^>]*>\s*/i)
    if (match) index += match[0].length
  }

  return {
    prefix: source.slice(0, index),
    rest: source.slice(index),
  }
}

function withSpacing(prefix, rendered, rest) {
  const trimmedRest = rest.replace(/^\s*/, "")
  return `${prefix}${rendered}${trimmedRest}`
}

function normalizeExistingHeader(comment, style) {
  if (style.name === "js-block") {
    return normalizeBody(
      comment
        .replace(/^\/\*\*?/, "")
        .replace(/\*\/$/, "")
        .split(/\r?\n/)
        .map((line) => line.replace(/^\s*\* ?/, ""))
        .join("\n")
    )
  }

  if (style.name === "html-comment") {
    return normalizeBody(
      comment
        .replace(/^<!--/, "")
        .replace(/-->$/, "")
    )
  }

  if (style.name === "tex-line") {
    return normalizeBody(
      comment
        .split(/\r?\n/)
        .map((line) => line.replace(/^\s*% ?/, ""))
        .join("\n")
    )
  }

  return normalizeBody(comment)
}

function normalizeBody(text) {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim()
}

function sha(value) {
  return createHash("sha256").update(value).digest("hex")
}

function looksLikeLegalHeader(normalized) {
  if (!normalized) return false
  return /(copyright|spdx-license-identifier|commercial license|gnu affero|apache license|mit license)/i.test(
    normalized
  )
}

function renderJsBlock(body) {
  const lines = normalizeBody(body).split("\n")
  const renderedLines = lines.map((line) => (line ? ` * ${line}` : " *"))
  return `/**\n${renderedLines.join("\n")}\n */\n\n`
}

function renderHtmlComment(body) {
  const lines = normalizeBody(body).split("\n")
  return `<!--\n${lines.join("\n")}\n-->\n\n`
}

function renderTexComment(body) {
  const lines = normalizeBody(body).split("\n")
  return `${lines.map((line) => (line ? `% ${line}` : "%")).join("\n")}\n\n`
}

function extractJsBlock(source) {
  const match = source.match(/^(\s*\/\*\*?[\s\S]*?\*\/)(\s*)/)
  if (!match) return null
  return {
    comment: match[1],
    trailing: match[2] || "",
    end: match[0].length,
  }
}

function extractHtmlComment(source) {
  const match = source.match(/^(\s*<!--[\s\S]*?-->)(\s*)/)
  if (!match) return null
  return {
    comment: match[1].trimStart(),
    trailing: match[2] || "",
    end: match[0].length,
  }
}

function extractTexComment(source) {
  const match = source.match(/^((?:\s*%.*(?:\n|$))+)(\s*)/)
  if (!match) return null
  return {
    comment: match[1].replace(/\s+$/, ""),
    trailing: match[2] || "",
    end: match[0].length,
  }
}

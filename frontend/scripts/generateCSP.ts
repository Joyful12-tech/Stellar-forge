/**
 * Build-time script: generates the CSP string from src/csp/policy.ts and
 * writes it into index.html, public/_headers, and both vercel.json configs
 * (frontend/vercel.json and the repo-root vercel.json).
 *
 * Usage:
 *   npx tsx scripts/generateCSP.ts          # write mode (run via prebuild)
 *   npx tsx scripts/generateCSP.ts --check  # validate only, exit 1 on drift (CI)
 */

import { existsSync, readFileSync, writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { CSP_DIRECTIVES, buildCSPString } from '../src/csp/policy.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const CHECK_ONLY = process.argv.includes('--check')

const CSP = buildCSPString(CSP_DIRECTIVES)

// ── index.html ────────────────────────────────────────────────────────────────

const indexPath = resolve(root, 'index.html')
const indexContent = readFileSync(indexPath, 'utf-8')

const metaTagRegex = /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"/

const metaMatch = indexContent.match(metaTagRegex)

if (!metaMatch) {
  console.error('generateCSP: Content-Security-Policy meta tag not found in index.html')
  process.exit(1)
}

const existingMetaCSP = metaMatch[1]

if (existingMetaCSP !== CSP) {
  if (CHECK_ONLY) {
    console.error('generateCSP: index.html CSP meta tag is out of sync with policy.ts')
    console.error('  expected:', CSP)
    console.error('  found:   ', existingMetaCSP)
    process.exit(1)
  }
  const updated = indexContent.replace(metaTagRegex, (match) => match.replace(existingMetaCSP, CSP))
  writeFileSync(indexPath, updated)
  console.log('generateCSP: updated index.html')
} else {
  console.log('generateCSP: index.html is up to date')
}

// ── public/_headers ───────────────────────────────────────────────────────────

const headersPath = resolve(root, 'public/_headers')
const headersContent = readFileSync(headersPath, 'utf-8')

const cspLineRegex = /^(\s*Content-Security-Policy:\s*)(.+)$/m
const match = headersContent.match(cspLineRegex)

if (!match) {
  console.error('generateCSP: Content-Security-Policy line not found in public/_headers')
  process.exit(1)
}

const existingCSP = match[2]?.trim() ?? ''

if (existingCSP !== CSP) {
  if (CHECK_ONLY) {
    console.error('generateCSP: public/_headers CSP is out of sync with policy.ts')
    console.error('  expected:', CSP)
    console.error('  found:   ', existingCSP)
    process.exit(1)
  }
  const updated = headersContent.replace(cspLineRegex, `$1${CSP}`)
  writeFileSync(headersPath, updated)
  console.log('generateCSP: updated public/_headers')
} else {
  console.log('generateCSP: public/_headers is up to date')
}

// ── vercel.json (frontend + repo root) ───────────────────────────────────────

// Both configs ship a header-CSP and both are documented as authoritative for
// production deployment, so both must be generated. The root file was
// previously left out, which is how it drifted from policy.ts unnoticed.
const vercelPaths = [resolve(root, 'vercel.json'), resolve(root, '../vercel.json')]

for (const vercelPath of vercelPaths) {
  if (!existsSync(vercelPath)) continue

  const vercel = JSON.parse(readFileSync(vercelPath, 'utf-8')) as {
    headers?: { source: string; headers: { key: string; value: string }[] }[]
  }

  const vercelHeader = vercel.headers
    ?.flatMap((block) => block.headers)
    .find((h) => h.key === 'Content-Security-Policy')

  if (!vercelHeader) {
    console.error(`generateCSP: Content-Security-Policy header not found in ${vercelPath}`)
    process.exit(1)
  }

  if (vercelHeader.value !== CSP) {
    if (CHECK_ONLY) {
      console.error(`generateCSP: ${vercelPath} CSP is out of sync with policy.ts`)
      console.error('  expected:', CSP)
      console.error('  found:   ', vercelHeader.value)
      process.exit(1)
    }
    vercelHeader.value = CSP
    writeFileSync(vercelPath, JSON.stringify(vercel, null, 2) + '\n')
    console.log(`generateCSP: updated ${vercelPath}`)
  } else {
    console.log(`generateCSP: ${vercelPath} is up to date`)
  }
}

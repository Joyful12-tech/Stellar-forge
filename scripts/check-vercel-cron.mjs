import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT_DIR = path.resolve(__dirname, '..')

/**
 * Cron paths that must be scheduled in the deployed project's `vercel.json`.
 *
 * Vercel Cron Jobs are configured *exclusively* by a `crons` array in the
 * deployed project's `vercel.json`. Issue #1090: the indexer's entrypoint,
 * its design doc and its spec all claimed the cron existed, but no config
 * file had ever contained a `crons` key — so the indexer never ran, the
 * store stayed empty, `/api/health/indexer` reported `healthy: false`
 * forever, and the whole subsystem was dead code in every deployment. The
 * app still worked (the frontend falls back to direct RPC), which is exactly
 * why nobody noticed. This check makes that failure loud at build time.
 */
export const REQUIRED_CRON_PATHS = ['/api/cron/index-tokens']

/**
 * The repo root is the authoritative Vercel project root: the serverless
 * functions live in `api/` at the repo root, and the frontend calls them
 * same-origin (`/api/ipfs/*`, `/api/health/*`). A project rooted at
 * `frontend/` would ship no functions at all, so `frontend/vercel.json` must
 * not carry crons — they would target paths that do not exist there.
 */
const ROOT_CONFIG = 'vercel.json'
const FRONTEND_CONFIG = path.join('frontend', 'vercel.json')

/** Where a `crons` path is expected to resolve on disk. */
function handlerCandidates(cronPath) {
  const rel = cronPath.replace(/^\//, '')
  return [`${rel}.ts`, `${rel}.js`, path.join(rel, 'index.ts'), path.join(rel, 'index.js')]
}

/**
 * Expands one numeric cron field — wildcard, step, single value, range, and
 * comma-separated combinations of those — into the sorted values it matches.
 *
 * @param {string} field
 * @param {number} min
 * @param {number} max
 * @returns {number[] | null} null if the field uses syntax this cannot expand
 */
function expandField(field, min, max) {
  const values = new Set()

  for (const part of field.split(',')) {
    const match = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part)
    if (!match) return null

    const [, range, stepRaw] = match
    const step = stepRaw === undefined ? 1 : Number(stepRaw)
    if (!Number.isInteger(step) || step < 1) return null

    let from
    let to
    if (range === '*') {
      from = min
      to = max
    } else if (range.includes('-')) {
      ;[from, to] = range.split('-').map(Number)
    } else {
      from = Number(range)
      to = stepRaw === undefined ? from : max
    }

    if (from < min || to > max || from > to) return null
    for (let value = from; value <= to; value += step) values.add(value)
  }

  return values.size === 0 ? null : [...values].sort((a, b) => a - b)
}

/**
 * Longest possible gap, in minutes, between two firings of a cron expression.
 *
 * Deliberately partial: it reasons about the minute and hour fields only, and
 * requires day-of-month, month and day-of-week to be `*` — that covers every
 * cadence a Vercel deployment realistically schedules for an indexer. Anything
 * else returns `null`, and the cadence check is skipped rather than guessed at.
 *
 * @param {string} schedule
 * @returns {number | null}
 */
export function maxGapMinutes(schedule) {
  if (typeof schedule !== 'string') return null
  const fields = schedule.trim().split(/\s+/)
  if (fields.length !== 5) return null

  const [minuteField, hourField, ...dateFields] = fields
  if (dateFields.some((f) => f !== '*')) return null

  const minutes = expandField(minuteField, 0, 59)
  const hours = expandField(hourField, 0, 23)
  if (!minutes || !hours) return null

  const firings = []
  for (const hour of hours) {
    for (const minute of minutes) firings.push(hour * 60 + minute)
  }
  firings.sort((a, b) => a - b)

  // Wrap-around: the gap from the last firing of one day to the first of the
  // next is often the largest one, and it is the one that matters.
  let gap = 24 * 60 - firings[firings.length - 1] + firings[0]
  for (let i = 1; i < firings.length; i += 1) {
    gap = Math.max(gap, firings[i] - firings[i - 1])
  }
  return gap
}

/**
 * Reads `LAG_WARNING_SECONDS` out of the ingest module without importing it —
 * the script layer is plain Node with no TypeScript toolchain.
 *
 * @param {string} rootDir
 * @returns {number | null}
 */
export function readLagWarningSeconds(rootDir = ROOT_DIR) {
  const file = path.join(rootDir, 'api', '_lib', 'indexer', 'ingest.ts')
  if (!fs.existsSync(file)) return null
  const source = fs.readFileSync(file, 'utf8')
  const match = /export const LAG_WARNING_SECONDS\s*=\s*([^\n]+)/.exec(source)
  if (!match) return null
  const expression = match[1]
    .replace(/\/\/.*$/, '')
    .replace(/;\s*$/, '')
    .trim()
  // Only arithmetic over integers, e.g. `15 * 60`.
  if (!/^[\d\s*+]+$/.test(expression)) return null
  const value = Function(`"use strict"; return (${expression});`)()
  return Number.isFinite(value) ? value : null
}

/**
 * @param {{ rootDir?: string, requiredPaths?: string[] }} [options]
 * @returns {{ errors: string[], crons: Array<{ path: string, schedule: string }> }}
 */
export function checkVercelCron({ rootDir = ROOT_DIR, requiredPaths = REQUIRED_CRON_PATHS } = {}) {
  const errors = []
  const configPath = path.join(rootDir, ROOT_CONFIG)

  if (!fs.existsSync(configPath)) {
    return { errors: [`${ROOT_CONFIG} is missing at the repo root.`], crons: [] }
  }

  let config
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  } catch (error) {
    return { errors: [`${ROOT_CONFIG} is not valid JSON: ${error.message}`], crons: [] }
  }

  const crons = Array.isArray(config.crons) ? config.crons : null
  if (!crons || crons.length === 0) {
    errors.push(
      `${ROOT_CONFIG} has no non-empty "crons" array. Vercel schedules cron jobs only from this file; ` +
        `without it ${requiredPaths.join(', ')} is never invoked. See docs/indexer.md#deployment.`,
    )
    return { errors, crons: [] }
  }

  const lagWarningSeconds = readLagWarningSeconds(rootDir)

  for (const [index, entry] of crons.entries()) {
    const label = `${ROOT_CONFIG} crons[${index}]`

    if (!entry || typeof entry.path !== 'string' || entry.path.length === 0) {
      errors.push(`${label} has no "path".`)
      continue
    }
    if (typeof entry.schedule !== 'string' || entry.schedule.trim().split(/\s+/).length !== 5) {
      errors.push(
        `${label} ("${entry.path}") needs a five-field cron "schedule" (got ${JSON.stringify(entry.schedule)}).`,
      )
      continue
    }

    const candidates = handlerCandidates(entry.path)
    if (!candidates.some((candidate) => fs.existsSync(path.join(rootDir, candidate)))) {
      errors.push(
        `${label} targets "${entry.path}" but no handler exists there (looked for ${candidates.join(', ')}).`,
      )
    }

    // A cadence coarser than the warning threshold means /api/health/indexer
    // is degraded even when the indexer is working perfectly. Either the
    // cadence or the thresholds are wrong; both are a deploy-time decision.
    const gap = maxGapMinutes(entry.schedule)
    if (gap !== null && lagWarningSeconds !== null && gap * 60 > lagWarningSeconds) {
      errors.push(
        `${label} ("${entry.path}") can go ${gap} minutes between runs, which exceeds ` +
          `LAG_WARNING_SECONDS (${lagWarningSeconds}s) in api/_lib/indexer/ingest.ts. ` +
          `/api/health/indexer would report a lag warning even when ingest is healthy — ` +
          `tighten the schedule or raise the thresholds to match the plan's cadence.`,
      )
    }
  }

  const scheduled = new Set(crons.map((entry) => entry?.path))
  for (const required of requiredPaths) {
    if (!scheduled.has(required)) {
      errors.push(
        `${ROOT_CONFIG} "crons" does not schedule ${required}. See docs/indexer.md#deployment.`,
      )
    }
  }

  const frontendConfigPath = path.join(rootDir, FRONTEND_CONFIG)
  if (fs.existsSync(frontendConfigPath)) {
    try {
      const frontendConfig = JSON.parse(fs.readFileSync(frontendConfigPath, 'utf8'))
      if (frontendConfig.crons !== undefined) {
        errors.push(
          `${FRONTEND_CONFIG} defines "crons", but a project rooted at frontend/ ships no api/ ` +
            `functions, so those paths would 404. Schedule crons in ${ROOT_CONFIG} instead.`,
        )
      }
    } catch (error) {
      errors.push(`${FRONTEND_CONFIG} is not valid JSON: ${error.message}`)
    }
  }

  return { errors, crons }
}

if (process.argv[1] === __filename) {
  const { errors, crons } = checkVercelCron()
  if (errors.length > 0) {
    console.error('❌ Vercel cron configuration check failed:')
    for (const err of errors) {
      console.error(`  - ${err}`)
    }
    process.exit(1)
  }
  console.log(
    `✅ vercel.json schedules ${crons.length} cron job(s): ` +
      crons.map((entry) => `${entry.path} @ "${entry.schedule}"`).join(', '),
  )
}

#!/usr/bin/env node

/**
 * Analytics Bypass Check — issue #1118 / ADR-005 REQ-ADR005-08
 *
 * Scans the source tree for files that import directly from
 * `services/analytics` and use the raw trackEvent / trackPageView /
 * window.plausible APIs outside of:
 *   - the analytics service itself  (src/services/analytics.ts)
 *   - test files                    (*.test.ts / *.test.tsx)
 *   - the useAnalytics hook         (src/hooks/useAnalytics.ts)
 *
 * WHY THIS MATTERS (GDPR / CCPA consent):
 *   The opt-out consent check lives in `analytics.ts` (isOptedOut()).
 *   Every call site that reaches window.plausible *through* trackEvent /
 *   trackPageView inherits the consent check automatically.  A call site that
 *   bypasses these functions and invokes window.plausible directly would
 *   silently ignore the user's recorded opt-out preference.
 *
 *   This script ensures no such bypass accidentally enters the codebase.
 *
 * Usage:
 *   node scripts/check-analytics-bypass.mjs
 *
 * Exit codes:
 *   0 – no violations found
 *   1 – one or more violations found (CI-blocking)
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SRC_DIR = resolve(__dirname, '..', 'src')

// ----------------------------------------------------------------------------
// Allowed files — these are permitted to reference analytics.ts directly
// ----------------------------------------------------------------------------
const ALLOWED_PATHS = [
  // The service module itself
  'services/analytics.ts',
  // The hook that wraps the service (only uses isOptedOut / setOptOut, not tracking fns)
  'hooks/useAnalytics.ts',
  // App.tsx calls trackPageView() inside a useEffect to record SPA route changes.
  // This is safe because trackPageView() internally calls isEnabled() which calls
  // isOptedOut() on every invocation — the consent check is enforced inside the
  // service, not in the caller.  Prefer this explicit allowance over silently
  // passing; review if new tracking call sites are added to App.tsx.
  'App.tsx',
]

// Allowed to contain tracking function names only in test files
const TEST_FILE_PATTERN = /\.test\.(ts|tsx)$/

// ----------------------------------------------------------------------------
// ADR-005: REQ-ADR005-08 - These patterns enforce zero direct analytics bypasses.
// Every production tracking call must remain behind the centralized, consent-aware API.
// Patterns that indicate a bypass of the consent-aware API
// ----------------------------------------------------------------------------

/** Import that pulls trackEvent or trackPageView directly from analytics.ts */
const DIRECT_IMPORT_RE = /from\s+['"][^'"]*services\/analytics['"]/

/** Direct call to window.plausible (bypasses isEnabled check entirely) */
const WINDOW_PLAUSIBLE_RE = /window\.plausible\s*\??\s*\(/

// ----------------------------------------------------------------------------
// File traversal
// ----------------------------------------------------------------------------

/**
 * Recursively enumerate .ts / .tsx files under `dir`.
 * @param {string} dir
 * @returns {string[]}
 */
function walkTs(dir) {
  const results = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      if (entry === 'node_modules' || (entry === '__tests__' && full.includes('node_modules')))
        continue
      results.push(...walkTs(full))
    } else if (['.ts', '.tsx'].includes(extname(full))) {
      results.push(full)
    }
  }
  return results
}

// ----------------------------------------------------------------------------
// Main check
// ----------------------------------------------------------------------------

/**
 * @typedef {{ file: string; line: number; text: string; reason: string }} Violation
 */

function main() {
  const files = walkTs(SRC_DIR)
  /** @type {Violation[]} */
  const violations = []

  for (const absPath of files) {
    const relPath = relative(SRC_DIR, absPath).replace(/\\/g, '/')

    // Skip allowed files
    if (ALLOWED_PATHS.some((p) => relPath.endsWith(p))) continue

    // Skip test files (they intentionally import trackEvent to assert behaviour)
    if (TEST_FILE_PATTERN.test(relPath)) continue

    const lines = readFileSync(absPath, 'utf-8').split('\n')

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]

      if (DIRECT_IMPORT_RE.test(line)) {
        violations.push({
          file: relPath,
          line: i + 1,
          text: line.trim(),
          reason:
            'Direct import from services/analytics bypasses the useAnalytics hook. ' +
            'Use the useAnalytics hook in components, or call trackEvent/trackPageView from ' +
            'within a service layer that is itself guarded by the analytics module.',
        })
      }

      if (WINDOW_PLAUSIBLE_RE.test(line)) {
        violations.push({
          file: relPath,
          line: i + 1,
          text: line.trim(),
          reason:
            'Direct call to window.plausible bypasses isOptedOut() consent check. ' +
            'Use trackEvent() or trackPageView() from services/analytics instead.',
        })
      }
    }
  }

  if (violations.length === 0) {
    console.log('\n✅ Analytics bypass check passed — no violations found.\n')
    process.exit(0)
  }

  console.error(`\n❌ Analytics bypass check FAILED — ${violations.length} violation(s) found:\n`)

  for (const v of violations) {
    console.error(`  📄 src/${v.file}:${v.line}`)
    console.error(`     Code:   ${v.text}`)
    console.error(`     Reason: ${v.reason}`)
    console.error()
  }

  console.error(
    '  To fix: replace direct service/plausible usage with the useAnalytics hook\n' +
      '  or route the call through trackEvent() / trackPageView() which enforce consent.\n' +
      '  If the usage is intentional (e.g., a new allowed file), add it to ALLOWED_PATHS\n' +
      '  in scripts/check-analytics-bypass.mjs with a comment explaining the exception.\n',
  )

  process.exit(1)
}

main()

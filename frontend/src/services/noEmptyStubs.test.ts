import { describe, test, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// Guard against the regression that motivated issue #1017: `getAllTokens()`
// shipped as `return []`, so every consumer rendered a permanently empty state
// indistinguishable from "no data exists" — no error, no telemetry.
//
// This test fails the build if any service method's *entire* body is a bare
// empty-collection return (`return []` or `return {}`). Such a method is almost
// always an unimplemented stub masquerading as real data. Genuinely-
// unimplemented methods must fail loudly instead (e.g. `throw new
// Error('NotImplemented')`) so a silent stub can never ship again. (A nullable
// `return null` is a legitimate value, not fake-empty data, so it is allowed.)
//
// A plain-source regex scan is deliberate: it needs no build step and catches
// the pattern in review just as an ESLint rule would, without a custom plugin.

const SERVICES_DIR = dirname(fileURLToPath(import.meta.url))

/** Matches a function/method whose only statement returns an empty collection. */
const EMPTY_STUB = /\)\s*(?::\s*[^={;]+?)?\{\s*return\s*(?:\[\]|\{\})\s*;?\s*\}/g

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(full)
    if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) return []
    if (entry.name.includes('.test.')) return []
    return [full]
  })
}

describe('service layer has no silent empty-return stubs', () => {
  // Prove the detector actually matches the regression it guards against — a
  // regex that never matches would pass the scan below for the wrong reason.
  test('detects the original getAllTokens stub shape', () => {
    const stub = `async getAllTokens(): Promise<TokenInfo[]> {\n    return []\n  }`
    expect(stub.match(new RegExp(EMPTY_STUB))).not.toBeNull()
    const objStub = `function state(): S {\n    return {}\n  }`
    expect(objStub.match(new RegExp(EMPTY_STUB))).not.toBeNull()
    // The real, implemented method must NOT match.
    const real = `async getAllTokens(offset = 0, limit = 10) {\n    const x = 1\n    return { tokens, total }\n  }`
    expect(real.match(new RegExp(EMPTY_STUB))).toBeNull()
  })

  test.each(sourceFiles(SERVICES_DIR))('%s exposes no empty-collection stub method', (file) => {
    const source = readFileSync(file, 'utf8')
    const matches = source.match(EMPTY_STUB) ?? []
    expect(
      matches,
      `Found a method whose whole body returns an empty collection in ${file}. ` +
        `If this is intentionally unimplemented, throw an error (e.g. NotImplemented) ` +
        `instead of returning empty data that consumers cannot distinguish from a real ` +
        `empty result.`,
    ).toEqual([])
  })
})

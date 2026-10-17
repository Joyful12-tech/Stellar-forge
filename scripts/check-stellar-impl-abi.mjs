#!/usr/bin/env node
/**
 * Validates that contract.call(...) invocations in stellar-impl.ts match
 * the corresponding function signatures in contracts/token-factory/src/lib.rs.
 *
 * This is the permanent structural fix for issue #5 and the unchecked item
 * at docs/CODEBASE_AUDIT_CHECKLIST.md:102-104. Every contract call has its
 * argument count verified exactly against the Rust source, catching a
 * missing or extra argument before it silently breaks at RPC simulation time.
 *
 * Usage:
 *   node scripts/check-stellar-impl-abi.mjs
 *
 * Exit code:
 *   0 if all call sites match their signatures
 *   1 if any drift is detected
 */

import { readFileSync } from 'fs'
import { resolve } from 'path'
import { fileURLToPath } from 'url'

const LIB_RS = 'contracts/token-factory/src/lib.rs'
const STELLAR_IMPL = 'frontend/src/services/stellar-impl.ts'

const OPENERS = '([{<'
const CLOSERS = ')]}>'

/**
 * Split `text` on commas that are not nested inside (), [], {} or — when
 * `angleBrackets` is set, for Rust generics like `Map<Address, u32>` — <>.
 * `//` line comments and `/* *\/` block comments are dropped first, and
 * empty segments (e.g. from a trailing comma) are discarded.
 */
export function splitTopLevel(text, { angleBrackets = false } = {}) {
  const src = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  const parts = []
  let depth = 0
  let current = ''
  for (const ch of src) {
    const opens = OPENERS.indexOf(ch)
    const closes = CLOSERS.indexOf(ch)
    const tracked = (i) => i !== -1 && (angleBrackets || i !== 3)
    if (tracked(opens)) depth++
    else if (tracked(closes)) depth--
    else if (ch === ',' && depth === 0) {
      parts.push(current)
      current = ''
      continue
    }
    current += ch
  }
  parts.push(current)
  return parts.map((p) => p.trim()).filter(Boolean)
}

/**
 * Return the text between the `(` at `openIndex` and its matching `)`, or
 * `null` when it is unbalanced.
 */
function balancedParens(content, openIndex) {
  let depth = 0
  for (let i = openIndex; i < content.length; i++) {
    if (content[i] === '(') depth++
    else if (content[i] === ')' && --depth === 0) return content.slice(openIndex + 1, i)
  }
  return null
}

/**
 * Extract the public function signatures of the `impl TokenFactory` block.
 * Returns a map of function name -> number of arguments a caller passes,
 * i.e. excluding the host-injected `env: Env` parameter.
 *
 * Example:
 *   pub fn burn(env: Env, token_address: Address, from: Address, amount: i128)
 *   => { "burn": 3 }
 */
export function extractRustSignatures(content) {
  const signatures = new Map()

  // Find the impl TokenFactory block
  const implMatch = content.match(/impl TokenFactory[\s\S]*?^}(?=\s*$)/m)
  if (!implMatch) {
    throw new Error(`Could not find 'impl TokenFactory' block in ${LIB_RS}`)
  }

  const implBlock = implMatch[0]
  const fnPattern = /pub\s+fn\s+(\w+)\s*\(/g
  let match

  while ((match = fnPattern.exec(implBlock)) !== null) {
    const params = balancedParens(implBlock, match.index + match[0].length - 1)
    if (params === null) continue
    const callerParams = splitTopLevel(params, { angleBrackets: true }).filter(
      (p) => !/^_?env\s*:\s*&?Env$/.test(p),
    )
    signatures.set(match[1], callerParams.length)
  }

  return signatures
}

/**
 * Extract all `contract.call('name', ...args)` invocations from stellar-impl.ts.
 * Returns an array of { functionName, argumentCount, location }, where
 * `argumentCount` excludes the function-name literal itself.
 *
 * Example:
 *   contract.call('burn', token, from, amount)
 *   => { functionName: 'burn', argumentCount: 3, location: 'line 616' }
 */
export function extractContractCalls(content) {
  const calls = []
  const callStartPattern = /contract\.call\s*\(\s*['"](\w+)['"]/g
  let match

  while ((match = callStartPattern.exec(content)) !== null) {
    const functionName = match[1]
    const lineNumber = content.substring(0, match.index).split('\n').length
    const inner = balancedParens(content, content.indexOf('(', match.index))

    if (inner === null) {
      console.warn(
        `WARNING: Could not find matching paren for ${functionName} at line ${lineNumber}`,
      )
      continue
    }

    calls.push({
      functionName,
      // The first segment is the function-name literal.
      argumentCount: splitTopLevel(inner).length - 1,
      location: `line ${lineNumber}`,
    })
  }

  return calls
}

/**
 * Compare call sites against signatures. Returns `{ ok, lines }` where
 * `lines` is the human-readable report, each entry `{ ok, text }`.
 */
export function checkCalls(signatures, calls) {
  const lines = calls.map(({ functionName, argumentCount, location }) => {
    if (!signatures.has(functionName)) {
      return {
        ok: false,
        text: `✗ ${functionName} at ${location}: NO MATCHING FUNCTION in lib.rs (maybe not exported as pub fn?)`,
      }
    }
    const expected = signatures.get(functionName)
    return argumentCount === expected
      ? { ok: true, text: `✓ ${functionName} at ${location}: ${argumentCount} args` }
      : {
          ok: false,
          text: `✗ ${functionName} at ${location}: ${argumentCount} args, expected ${expected}`,
        }
  })
  return { ok: lines.every((l) => l.ok), lines }
}

function main() {
  console.log(':: Validating stellar-impl.ts contract.call sites against lib.rs signatures...\n')

  let libRsContent, stellarImplContent
  try {
    libRsContent = readFileSync(resolve(LIB_RS), 'utf8')
    stellarImplContent = readFileSync(resolve(STELLAR_IMPL), 'utf8')
  } catch (err) {
    console.error(`ERROR: ${err.message}`)
    return 1
  }

  let signatures
  try {
    signatures = extractRustSignatures(libRsContent)
  } catch (err) {
    console.error(`ERROR: ${err.message}`)
    return 1
  }
  const calls = extractContractCalls(stellarImplContent)

  console.log(`Found ${signatures.size} public functions in lib.rs`)
  console.log(`Found ${calls.length} contract.call(...) invocations in stellar-impl.ts\n`)

  if (signatures.size === 0) {
    console.warn('WARNING: Could not extract any function signatures from lib.rs')
  }
  if (calls.length === 0) {
    console.warn('WARNING: Could not extract any contract.call invocations from stellar-impl.ts')
    return 0
  }

  console.log(':: Checking call sites...\n')
  const { ok, lines } = checkCalls(signatures, calls)
  for (const line of lines) (line.ok ? console.log : console.error)(line.text)
  console.log('')

  if (ok) {
    console.log('✓ All call sites match their function signatures')
    return 0
  }
  console.error('✗ Drift detected: some call sites do not match their signatures')
  return 1
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(main())
}

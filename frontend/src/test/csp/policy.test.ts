import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { buildCSPString, CSP_DIRECTIVES, type CSPDirectives } from '../../csp/policy'
import { NETWORK_CONFIGS } from '../../config/stellar'

const __dirname = dirname(fileURLToPath(import.meta.url))

describe('buildCSPString', () => {
  it('serializes directives into a valid CSP string', () => {
    const directives: CSPDirectives = {
      'default-src': ["'self'"],
      'script-src': ["'self'"],
      'style-src': ["'self'", "'unsafe-inline'"],
      'img-src': ["'self'", 'data:'],
      'connect-src': ["'self'"],
      'font-src': ["'self'"],
      'object-src': ["'none'"],
      'base-uri': ["'self'"],
      'frame-ancestors': ["'none'"],
      'form-action': ["'self'"],
      'upgrade-insecure-requests': [],
      'worker-src': ['blob:'],
    }
    const result = buildCSPString(directives)
    expect(result).toContain("default-src 'self'")
    expect(result).toContain("script-src 'self'")
    expect(result).toContain('upgrade-insecure-requests')
    // bare keyword — no trailing space
    expect(result).not.toMatch(/upgrade-insecure-requests\s+;/)
  })

  it('never includes unsafe-inline or unsafe-eval in script-src', () => {
    const result = buildCSPString(CSP_DIRECTIVES)
    const scriptSrcMatch = result.match(/script-src ([^;]+)/)
    const scriptSrc = scriptSrcMatch?.[1] ?? ''
    expect(scriptSrc).not.toContain("'unsafe-inline'")
    expect(scriptSrc).not.toContain("'unsafe-eval'")
  })

  it('style-src no longer includes unsafe-inline', () => {
    const result = buildCSPString(CSP_DIRECTIVES)
    const styleSrcMatch = result.match(/style-src ([^;]+)/)
    expect(styleSrcMatch).not.toBeNull()
    if (styleSrcMatch) {
      const styleSrc = styleSrcMatch[1]
      expect(styleSrc).not.toContain("'unsafe-inline'")
      expect(styleSrc).toContain("'self'")
    }
  })

  it('includes all required connect-src origins', () => {
    const result = buildCSPString(CSP_DIRECTIVES)
    expect(result).toContain('https://horizon.stellar.org')
    expect(result).toContain('https://horizon-testnet.stellar.org')
    expect(result).toContain('https://soroban-testnet.stellar.org')
    expect(result).toContain('https://soroban-mainnet.stellar.org')
    expect(result).toContain('https://api.pinata.cloud')
    expect(result).toContain('https://*.ingest.sentry.io')
  })

  it('emits upgrade-insecure-requests as a bare keyword', () => {
    const result = buildCSPString(CSP_DIRECTIVES)
    expect(result).toMatch(/(^|; )upgrade-insecure-requests(;|$)/)
  })
})

/**
 * Guards against the class of drift that shipped in #1158: connect-src listed
 * `rpc-mainnet.stellar.org` while every mainnet call actually went to
 * `soroban-mainnet.stellar.org`, silently breaking mainnet under a header-CSP.
 *
 * These assertions derive the expected hosts from NETWORK_CONFIGS instead of
 * hardcoding them, so changing an RPC URL without updating the CSP fails CI.
 */
describe('connect-src covers the configured Stellar endpoints', () => {
  const connectSrc = CSP_DIRECTIVES['connect-src']

  // standalone points at localhost over plain http and is dev-only — it is
  // covered by 'self' during local work and must not be whitelisted in prod.
  const deployedNetworks = ['testnet', 'mainnet'] as const

  const originOf = (url: string) => new URL(url).origin

  it.each(deployedNetworks)('%s soroban RPC origin is whitelisted', (network) => {
    expect(connectSrc).toContain(originOf(NETWORK_CONFIGS[network].sorobanRpcUrl))
  })

  it.each(deployedNetworks)('%s horizon origin is whitelisted', (network) => {
    expect(connectSrc).toContain(originOf(NETWORK_CONFIGS[network].horizonUrl))
  })

  it('serializes those origins into the connect-src directive', () => {
    const connectSrcString = buildCSPString(CSP_DIRECTIVES).match(/connect-src ([^;]+)/)?.[1] ?? ''
    const sources = connectSrcString.split(' ')

    for (const network of deployedNetworks) {
      expect(sources).toContain(originOf(NETWORK_CONFIGS[network].sorobanRpcUrl))
      expect(sources).toContain(originOf(NETWORK_CONFIGS[network].horizonUrl))
    }
  })

  it('does not whitelist stellar.org hosts no network config points at', () => {
    const configuredOrigins = deployedNetworks.flatMap((network) => [
      originOf(NETWORK_CONFIGS[network].sorobanRpcUrl),
      originOf(NETWORK_CONFIGS[network].horizonUrl),
    ])

    const stellarHosts = connectSrc.filter((src) => src.endsWith('.stellar.org'))

    for (const host of stellarHosts) {
      expect(configuredOrigins).toContain(host)
    }
  })
})

/**
 * policy.ts is the single source of truth, but the browser only ever sees the
 * generated deployment configs. `npm run prebuild` syncs them; this asserts the
 * committed copies are in sync so a forgotten regeneration fails CI.
 */
describe('generated deployment configs match policy.ts', () => {
  const repoRoot = resolve(__dirname, '../../../..')
  const frontendRoot = resolve(repoRoot, 'frontend')
  const expectedCSP = buildCSPString(CSP_DIRECTIVES)

  const jsonConfigs = [resolve(repoRoot, 'vercel.json'), resolve(frontendRoot, 'vercel.json')]

  it.each(jsonConfigs)('%s ships the current CSP header', (configPath) => {
    const config = JSON.parse(readFileSync(configPath, 'utf-8')) as {
      headers?: { headers: { key: string; value: string }[] }[]
    }

    const header = config.headers
      ?.flatMap((block) => block.headers)
      .find((h) => h.key === 'Content-Security-Policy')

    expect(header?.value).toBe(expectedCSP)
  })

  it('public/_headers ships the current CSP', () => {
    const headers = readFileSync(resolve(frontendRoot, 'public/_headers'), 'utf-8')
    const csp = headers.match(/^\s*Content-Security-Policy:\s*(.+)$/m)?.[1]
    expect(csp?.trim()).toBe(expectedCSP)
  })

  it('index.html meta tag ships the current CSP', () => {
    const html = readFileSync(resolve(frontendRoot, 'index.html'), 'utf-8')
    const csp = html.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"/)?.[1]
    expect(csp).toBe(expectedCSP)
  })
})

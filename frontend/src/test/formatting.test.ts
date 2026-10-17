import { describe, it, expect, vi, afterEach } from 'vitest'
import * as fc from 'fast-check'
import {
  formatTimestamp,
  timeAgo,
  formatXLM,
  truncateAddress,
  stroopsToXLM,
  xlmToStroops,
  stellarExplorerUrl,
  ipfsToGatewayUrl,
  TOKEN_IMAGE_PLACEHOLDER,
} from '../utils/formatting'

describe('ipfsToGatewayUrl', () => {
  it('converts CIDv0 ipfs URI to pinata gateway URL', () => {
    expect(ipfsToGatewayUrl('ipfs://QmXxx')).toBe('https://gateway.pinata.cloud/ipfs/QmXxx')
  })

  it('converts CIDv1 ipfs URI to pinata gateway URL', () => {
    expect(
      ipfsToGatewayUrl('ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'),
    ).toBe(
      'https://gateway.pinata.cloud/ipfs/bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi',
    )
  })

  // Previously this asserted non-IPFS URIs were "returned unchanged". That
  // passthrough was the SSRF/tracking-beacon hole #984 set out to close: token
  // metadata is attacker-controlled, so an arbitrary URL reaching an <img src>
  // makes every viewer's browser call out to the token creator's server.
  it('refuses to pass an arbitrary http(s) URL through', () => {
    expect(ipfsToGatewayUrl('https://evil.example.com/pixel.png')).toBe(TOKEN_IMAGE_PLACEHOLDER)
  })

  it.each([
    ['a javascript: URI', 'javascript:alert(1)'],
    ['a data: URI', 'data:text/html,<script>alert(1)</script>'],
    ['a protocol-relative URL', '//evil.example.com/pixel.png'],
    ['an empty string', ''],
    ['an ipfs URI with no CID', 'ipfs://'],
    ['an ipfs URI with path traversal', 'ipfs://../../etc/passwd'],
    ['an ipfs URI smuggling a host', 'ipfs://evil.example.com/../x'],
  ])('resolves %s to the placeholder', (_label, uri) => {
    expect(ipfsToGatewayUrl(uri)).toBe(TOKEN_IMAGE_PLACEHOLDER)
  })

  it('never returns a URL outside the configured gateway origin', () => {
    fc.assert(
      fc.property(fc.string(), (uri) => {
        const result = ipfsToGatewayUrl(uri)
        return (
          result === TOKEN_IMAGE_PLACEHOLDER ||
          result.startsWith('https://gateway.pinata.cloud/ipfs/')
        )
      }),
    )
  })
})

describe('stellarExplorerUrl', () => {
  it('builds a testnet tx link', () => {
    expect(stellarExplorerUrl('tx', 'abc123', 'testnet')).toBe(
      'https://stellar.expert/explorer/testnet/tx/abc123',
    )
  })

  it('builds a mainnet tx link', () => {
    expect(stellarExplorerUrl('tx', 'abc123', 'mainnet')).toBe(
      'https://stellar.expert/explorer/public/tx/abc123',
    )
  })

  it('builds a contract link', () => {
    expect(stellarExplorerUrl('contract', 'CABC', 'testnet')).toBe(
      'https://stellar.expert/explorer/testnet/contract/CABC',
    )
  })

  it('builds an account link', () => {
    expect(stellarExplorerUrl('account', 'GABC', 'mainnet')).toBe(
      'https://stellar.expert/explorer/public/account/GABC',
    )
  })

  it('defaults to testnet', () => {
    expect(stellarExplorerUrl('tx', 'xyz')).toContain('testnet')
  })

  // Feature: stellar-explorer-links, Property 1: URL base path matches network
  it('Property 1: URL base path matches network', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('tx' as const, 'contract' as const, 'account' as const),
        fc.string({ minLength: 1 }),
        fc.constantFrom('testnet' as const, 'mainnet' as const),
        (type, id, network) => {
          const url = stellarExplorerUrl(type, id, network)
          const expectedBase =
            network === 'mainnet'
              ? 'https://stellar.expert/explorer/public'
              : 'https://stellar.expert/explorer/testnet'
          return url.startsWith(expectedBase)
        },
      ),
      { numRuns: 100 },
    )
  })

  // Feature: stellar-explorer-links, Property 2: URL pathname contains correct resource segment and identifier (round-trip)
  it('Property 2: URL pathname contains correct resource segment and identifier', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('tx' as const, 'contract' as const, 'account' as const),
        // Use alphanumeric identifiers to avoid URL normalization edge cases
        // (e.g. '.' and '..' are normalized by the URL parser as path segments)
        fc.stringMatching(/^[a-zA-Z0-9_-]+$/).filter((s) => s.length >= 1),
        fc.constantFrom('testnet' as const, 'mainnet' as const),
        (type, id, network) => {
          const url = stellarExplorerUrl(type, id, network)
          const parsed = new URL(url)
          return parsed.pathname.includes(`/${type}/${id}`)
        },
      ),
      { numRuns: 100 },
    )
  })
})

describe('formatXLM', () => {
  it('formats a number to 7 decimal places with XLM suffix', () => {
    // formatXLM takes a raw stroop amount; 10,000,000 stroops = 1 XLM
    expect(formatXLM(10000000)).toBe('1.0000000 XLM')
  })

  it('handles a string input', () => {
    expect(formatXLM('25000000')).toBe('2.5000000 XLM')
  })

  it('handles zero', () => {
    expect(formatXLM(0)).toBe('0.0000000 XLM')
  })
})

describe('truncateAddress', () => {
  it('truncates a long address with defaults', () => {
    // default chars=4: 4 start + '...' + 4 end = 'GABC...WXYZ'
    const addr = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ'
    expect(truncateAddress(addr)).toBe('GABC...WXYZ')
  })

  it('returns the address unchanged if short enough', () => {
    expect(truncateAddress('GABCD', 6)).toBe('GABCD')
  })

  it('respects a custom chars param', () => {
    expect(truncateAddress('GABCDEFGHIJ', 3)).toBe('GAB...HIJ')
  })
})

describe('stroopsToXLM', () => {
  it('converts 10000000 stroops to 1 XLM', () => {
    expect(stroopsToXLM(10000000)).toBe(1)
  })

  it('handles string input', () => {
    expect(stroopsToXLM('5000000')).toBe(0.5)
  })

  it('formats 70000000 stroops as readable XLM', () => {
    expect(formatXLM(70000000)).toBe('7.0000000 XLM')
  })
})

describe('xlmToStroops', () => {
  it('converts 1 XLM to 10000000 stroops', () => {
    expect(xlmToStroops(1)).toBe(10000000)
  })

  it('floors fractional stroops', () => {
    expect(xlmToStroops('0.00000001')).toBe(0)
  })

  it('handles edge cases', () => {
    expect(xlmToStroops(0)).toBe(0)
    expect(xlmToStroops(1000000000000000)).toBe(10000000000000000000000)
  })
})

describe('round-trip conversion', () => {
  it('xlmToStroops(stroopsToXLM(x)) === x', () => {
    const testValues = [10000000, 5000000, 1000000, 100000, 10000, 1000, 100, 10, 1]

    testValues.forEach((value) => {
      expect(xlmToStroops(stroopsToXLM(value))).toBe(value)
    })
  })

  it('handles zero', () => {
    expect(xlmToStroops(stroopsToXLM(0))).toBe(0)
  })

  it('handles large numbers', () => {
    const largeValue = 1000000000000000
    expect(xlmToStroops(stroopsToXLM(largeValue))).toBe(largeValue)
  })
})

describe('formatTimestamp', () => {
  it('formats a known timestamp correctly', () => {
    // 2026-03-19T15:28:00Z
    expect(formatTimestamp(1773934080)).toBe('Mar 19, 2026, 3:28 PM UTC')
  })

  it('handles 0 without throwing', () => {
    expect(() => formatTimestamp(0)).not.toThrow()
  })

  it('handles a future timestamp without throwing', () => {
    expect(() => formatTimestamp(9999999999)).not.toThrow()
  })
})

describe('timeAgo', () => {
  afterEach(() => vi.useRealTimers())

  const freeze = (nowSeconds: number) => {
    vi.useFakeTimers()
    vi.setSystemTime(nowSeconds * 1000)
  }

  it('returns seconds ago', () => {
    freeze(1000)
    expect(timeAgo(955)).toBe('45 seconds ago')
  })

  it('returns singular second', () => {
    freeze(1000)
    expect(timeAgo(999)).toBe('1 second ago')
  })

  it('returns minutes ago', () => {
    freeze(1000)
    expect(timeAgo(880)).toBe('2 minutes ago')
  })

  it('returns hours ago', () => {
    freeze(7200)
    expect(timeAgo(3600)).toBe('1 hour ago')
  })

  it('returns days ago', () => {
    freeze(86400 * 3)
    expect(timeAgo(86400)).toBe('2 days ago')
  })

  it('returns minutes for future timestamps over a minute away', () => {
    freeze(1000)
    expect(timeAgo(2000)).toBe('in 17 minutes')
  })

  it('handles 0 without throwing', () => {
    freeze(1000)
    expect(() => timeAgo(0)).not.toThrow()
  })
})

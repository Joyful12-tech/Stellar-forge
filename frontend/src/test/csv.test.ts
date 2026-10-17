import { describe, it, expect } from 'vitest'
import { serializeTransactionsToCSV } from '../utils/csv'
import type { TransactionHistoryItem } from '../hooks/useTransactionHistory'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeItem(overrides: Partial<TransactionHistoryItem> = {}): TransactionHistoryItem {
  return {
    id: 'tx-1',
    type: 'mint',
    token: 'USDC',
    amount: '100.50',
    date: '2026-03-19T15:28:00Z',
    status: 'success',
    hash: 'abc123def456',
    ...overrides,
  }
}

// ── Formula-injection guard tests (CWE-1236) ──────────────────────────────────

describe('formula injection guard', () => {
  it('neutralizes a value starting with =', () => {
    const csv = serializeTransactionsToCSV([makeItem({ hash: '=1+1' })])
    expect(csv).toContain("'=1+1")
  })

  it('neutralizes a value starting with +', () => {
    const csv = serializeTransactionsToCSV([makeItem({ token: '+SUM(A1:A10)' })])
    expect(csv).toContain("'+SUM(A1:A10)")
  })

  it('neutralizes a value starting with -', () => {
    const csv = serializeTransactionsToCSV([makeItem({ token: '-1+2' })])
    expect(csv).toContain("'-1+2")
  })

  it('neutralizes a value starting with @', () => {
    const csv = serializeTransactionsToCSV([makeItem({ hash: '@SUM(A1:A9)' })])
    expect(csv).toContain("'@SUM(A1:A9)")
  })

  it('neutralizes a value starting with tab', () => {
    const csv = serializeTransactionsToCSV([makeItem({ token: '\t=2+2' })])
    expect(csv).toContain("'\t=2+2")
  })

  it('neutralizes a value starting with carriage return', () => {
    const csv = serializeTransactionsToCSV([makeItem({ token: '\r=2+2' })])
    expect(csv).toContain("'\r=2+2")
  })

  it('guards every exported column, not just one', () => {
    const csv = serializeTransactionsToCSV([
      makeItem({
        date: '=NOW()',
        token: '=A1',
        amount: '=B1',
        hash: '=C1',
      }),
    ])
    expect(csv).toContain("'=NOW()")
    expect(csv).toContain("'=A1")
    expect(csv).toContain("'=B1")
    expect(csv).toContain("'=C1")
  })

  it('still quote-escapes a guarded value containing commas and quotes', () => {
    const csv = serializeTransactionsToCSV([makeItem({ token: '=HYPERLINK("http://x",1),y' })])
    // Apostrophe prefix applied, quotes doubled, field wrapped
    expect(csv).toContain('"\'=HYPERLINK(""http://x"",1),y"')
  })

  it('does not alter benign values', () => {
    const csv = serializeTransactionsToCSV([makeItem()])
    expect(csv).toContain('100.50')
    expect(csv).toContain('abc123def456')
    expect(csv).not.toContain("'100.50")
  })
})

// ── Serialization coverage across transaction types ──────────────────────────

describe('serializeTransactionsToCSV event coverage', () => {
  it('serializes a create transaction', () => {
    const csv = serializeTransactionsToCSV([
      makeItem({ type: 'create', token: 'NOVA', amount: '1000000' }),
    ])
    expect(csv).toContain('create')
    expect(csv).toContain('NOVA')
    expect(csv).toContain('1000000')
  })

  it('serializes a mint transaction', () => {
    const csv = serializeTransactionsToCSV([makeItem({ type: 'mint', amount: '500000' })])
    expect(csv).toContain('mint')
    expect(csv).toContain('500000')
  })

  it('serializes a burn transaction', () => {
    const csv = serializeTransactionsToCSV([makeItem({ type: 'burn', amount: '1000000' })])
    expect(csv).toContain('burn')
    expect(csv).toContain('1000000')
  })

  it('serializes an other-typed transaction', () => {
    const csv = serializeTransactionsToCSV([makeItem({ type: 'other', hash: 'feed42' })])
    expect(csv).toContain('other')
    expect(csv).toContain('feed42')
  })

  it('serializes multiple rows preserving order', () => {
    const csv = serializeTransactionsToCSV([
      makeItem({ hash: 'first' }),
      makeItem({ hash: 'second' }),
    ])
    const lines = csv.split('\n')
    expect(lines).toHaveLength(3)
    expect(lines[1]).toContain('first')
    expect(lines[2]).toContain('second')
  })
})

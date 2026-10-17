import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { FeeDisplay } from './FeeDisplay'

const baseState = {
  admin: 'GADMIN123456789012345678901234567890123456789012345',
  paused: false,
  treasury: 'GTREASURY1234567890123456789012345678901234567890',
  baseFee: '100000', // 0.01 XLM
  metadataFee: '50000', // 0.005 XLM
  tokenCount: 1,
  whitelistEnabled: false,
}

vi.mock('../hooks/useFactoryState', () => ({
  useFactoryState: () => ({ state: baseState, error: null }),
}))

vi.mock('../hooks/useXlmPrice', () => ({
  useXlmPrice: () => ({ price: 0.2, loading: false, unavailable: false }),
}))

// useFeeSplit is mocked per-test via mockReturnValue pattern below
let mockFeeSplit: { recipients: unknown[] | null; error: Error | null }
vi.mock('../hooks/useFeeSplit', () => ({
  useFeeSplit: () => mockFeeSplit,
}))

const RECIPIENT_A = 'GAAAAAAARECIPIENT1111111111111111111111111111111111111'
const RECIPIENT_B = 'GAAAAAAARECIPIENT2222222222222222222222222222222222222'

describe('FeeDisplay', () => {
  beforeEach(() => {
    // Default: no split configured → fall back to a single Treasury row
    mockFeeSplit = { recipients: [], error: null }
  })

  it('renders the base fee amount', () => {
    render(<FeeDisplay feeType="base" />)
    // 100000 stroops = 0.01 XLM
    expect(screen.getByText(/0\.0100000 XLM/)).toBeInTheDocument()
  })

  it('renders the metadata fee amount', () => {
    render(<FeeDisplay feeType="metadata" />)
    // 50000 stroops = 0.005 XLM
    expect(screen.getByText(/0\.0050000 XLM/)).toBeInTheDocument()
  })

  it('shows a single Treasury row as recipient when no split is configured', () => {
    mockFeeSplit = { recipients: [], error: null }
    render(<FeeDisplay feeType="base" />)
    const rows = screen.getAllByTestId('fee-recipient-row')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toHaveTextContent('Treasury')
    expect(rows[0]).toHaveTextContent('100%')
  })

  it('renders each recipient and its share when a fee split is configured', () => {
    mockFeeSplit = {
      recipients: [
        { address: RECIPIENT_A, bps: 6000 }, // 60%
        { address: RECIPIENT_B, bps: 4000 }, // 40%
      ],
      error: null,
    }
    render(<FeeDisplay feeType="base" />)
    const rows = screen.getAllByTestId('fee-recipient-row')
    expect(rows).toHaveLength(2)

    // Short-address format GAAAAA...1111 + share
    expect(rows[0]).toHaveTextContent('GAAAAA')
    expect(rows[0]).toHaveTextContent('1111')
    expect(rows[0]).toHaveTextContent('60%')
    expect(rows[1]).toHaveTextContent('40%')
  })

  it('multiplies the displayed total when count > 1 (batch)', () => {
    render(<FeeDisplay feeType="base" count={3} />)
    // 100000 × 3 = 300000 stroops = 0.03 XLM
    // Use getAllByText — the amount also appears in the recipient breakdown
    const matches = screen.getAllByText(/0\.0300000 XLM/)
    expect(matches.length).toBeGreaterThanOrEqual(1)
    expect(screen.getByLabelText('3 items')).toBeInTheDocument()
  })

  it('matches the fee_payment argument submitted on-chain for a batch', () => {
    // The on-chain batch charge is base_fee × tokens.len(). The displayed
    // total must equal the feePayment submitted to create_tokens_batch.
    const count = 5
    const baseFeeStroops = BigInt(baseState.baseFee)
    const expectedPayment = (baseFeeStroops * BigInt(count)).toString()

    render(<FeeDisplay feeType="base" count={count} />)

    // formatXLM renders stroops with 7 decimals; reconstruct the exact number
    const stroopsPerXlm = 10_000_000n
    const expectedBig = BigInt(expectedPayment)
    const whole = expectedBig / stroopsPerXlm
    const frac = expectedBig % stroopsPerXlm
    const expected = `${whole}.${frac.toString().padStart(7, '0')} XLM`

    const matches = screen.getAllByText(new RegExp(expected.replace('.', '\\.')))
    expect(matches.length).toBeGreaterThanOrEqual(1)
  })
})

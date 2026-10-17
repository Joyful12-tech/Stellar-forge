# FeeDisplay Component

## Purpose

Pre-signature fee display that shows the user the exact fee amount (in XLM + USD) and its recipient(s) before signing any on-chain transaction. Every fee-charging form in the app mounts `FeeDisplay` so the cost is never hidden.

## Requirements

### Fee amount

- The component reads the on-chain `base_fee` / `metadata_fee` from `useFactoryState` (not from a hardcoded constant or from the `stellarService` singleton, which is not network-aware).
- The amount is rendered in XLM (7 decimal places) plus a CoinGecko-derived USD estimate when available.
- A loading skeleton is shown while the factory state is being fetched.
- `unavailable` is shown when the RPC call fails.

### Fee split

- When the admin has configured a fee split via `set_fee_split`, the component reads `get_fee_split()` (a read-only contract view function) via `useFeeSplit` and renders each recipient with its percentage share.
- When no split is configured, a single `Treasury` row is shown as the recipient — the destination of the fee is never invisible.
- The split percentages are derived from the on-chain basis points (bps, out of 10_000) and sum to exactly 100% when a split is configured (enforced by the contract's `set_fee_split`).

### Batch creation

- `FeeDisplay` accepts an optional `count` prop (default `1`). When `count > 1`, the displayed total is `fee × count`, matching the on-chain `total_fee = base_fee × tokens.len()` charged by `create_tokens_batch`.
- When `count > 1`, the per-recipient breakdown also shows the sub-total each recipient receives.

### Mounting

- `FeeDisplay` is mounted in every fee-charging form:
  - `TokenForm` (single-token creation, `feeType="base"`)
  - `MintForm` (token minting, `feeType="base"`)
  - `SetMetadataForm` (metadata update, `feeType="metadata"`)
  - Batch-creation flow (when one is added to the frontend, `feeType="base"` with `count > 1`)

### Testing

- A test asserts that the displayed total matches the `fee_payment` argument that will be submitted in the transaction.
- A test covers the recipient breakdown when a fee split is configured.
- A test covers the `count > 1` multiplier.

# Fee Display Spec

## Status

**Partially Shipped (Active Issue #1108)**

## Summary

Provide transparent, real-time fee breakdown and simulation before the user signs Soroban smart contract transactions.

## Current State & Shipped Code

- `FeeDisplay.tsx` component is partially implemented (`frontend/src/components/FeeDisplay.tsx`).
- Basic fee estimation is displayed in certain UI components, but pre-signature fee breakdowns for complex Soroban invocation resource requirements (resource fee, network fee, inclusion fee) are missing.

## Requirements & Remaining Gaps

1. **Pre-Signature Breakdown**: Show explicit breakdown of base fee, resource fee, and maximum transaction fee prior to Freighter wallet signature prompt.
2. **Dynamic Estimation**: Re-estimate fees dynamically when transaction parameters change.
3. **Error Feedback**: Present clear user notification when estimated fee exceeds account balance.

## Implementation References

- Component: `frontend/src/components/FeeDisplay.tsx`

## Related Issues

- Issue #1108: No pre-signature fee breakdown shown to users
- Issue #1117: Multiple `.kiro/specs` directories are abandoned stubs

// Shared exponential backoff math for polling loops that wait on transaction
// confirmation. Centralised so every poller (RPC-based in stellar-impl.ts,
// Horizon-based in useTransactionPolling.ts) grows its interval the same way
// instead of drifting into a fixed-cadence implementation.

export interface BackoffOptions {
  initialDelayMs: number
  maxDelayMs: number
  /** Jitter as a fraction of the base delay, applied symmetrically. Default ±10%. */
  jitterRatio?: number
}

/**
 * Computes the delay (ms) before the next poll attempt: exponential backoff
 * capped at maxDelayMs, with jitter to avoid thundering-herd bursts when many
 * transactions confirm around the same time.
 */
export function nextBackoffDelay(attempt: number, options: BackoffOptions): number {
  const { initialDelayMs, maxDelayMs, jitterRatio = 0.2 } = options
  const base = Math.min(initialDelayMs * Math.pow(2, attempt), maxDelayMs)
  const jitter =
    Math.floor(Math.random() * jitterRatio * base) - Math.floor((jitterRatio / 2) * base)
  return base + jitter
}

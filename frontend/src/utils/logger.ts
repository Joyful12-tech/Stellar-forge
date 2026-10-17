const isProd = import.meta.env.PROD

export const logger = {
  error(message: string, error?: unknown): void {
    if (!isProd) {
      console.error(message, error)
    }
    // Forward to Sentry or other monitoring when integrated
  },

  /**
   * A degraded-but-working condition — the operation still returned a correct
   * result, just via a slower or less preferred path (for example a token read
   * falling back from the indexer to direct RPC). Distinct from `error` so
   * that routine degradation does not inflate the error rate.
   */
  warn(message: string, context?: unknown): void {
    if (!isProd) {
      console.warn(message, context)
    }
    // Forward to Sentry or other monitoring when integrated
  },
}

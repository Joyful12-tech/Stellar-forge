// Environment variable validation

export const ENV = {
  network: import.meta.env.VITE_NETWORK || 'testnet',
  factoryContractId: import.meta.env.VITE_FACTORY_CONTRACT_ID ?? '',
  tokenWasmHash: import.meta.env.VITE_TOKEN_WASM_HASH ?? '',
  /*
   * Pinata credentials are deliberately absent. Vite inlines every `VITE_`
   * variable into the built JS, so reading them here published the key and
   * secret to every visitor (issue #921). They now live only in server env,
   * read by `api/_lib/pinata.ts`; the UI asks `/api/health/ipfs` whether
   * uploads are possible (see `useIpfsReady`).
   */
  /**
   * Off-chain indexer (issue #943). Defaults to **off**, so the app reads
   * directly from RPC unless a deployment explicitly opts in. Turning the flag
   * back off is the documented rollback: because the indexer is never a source
   * of truth, that loses speed, not data.
   */
  indexerEnabled: import.meta.env.VITE_INDEXER_ENABLED === 'true',
  /** Empty means same-origin, which is the normal Vercel deployment. */
  indexerBaseUrl: import.meta.env.VITE_INDEXER_BASE_URL ?? '',
} as const

export const isFactoryConfigured = (): boolean => Boolean(ENV.factoryContractId)
export const isIndexerEnabled = (): boolean => ENV.indexerEnabled

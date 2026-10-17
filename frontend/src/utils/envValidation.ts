// Environment variable validation

interface EnvVar {
  key: string
  value: string | undefined
  description: string
  required: boolean
}

const ENV_VARS: EnvVar[] = [
  {
    key: 'VITE_NETWORK',
    value: import.meta.env.VITE_NETWORK,
    description: 'Stellar network (testnet or mainnet)',
    required: false,
  },
  {
    key: 'VITE_FACTORY_CONTRACT_ID',
    value: import.meta.env.VITE_FACTORY_CONTRACT_ID,
    description: 'Soroban token-factory contract address',
    required: true,
  },
  {
    key: 'VITE_TOKEN_WASM_HASH',
    value: import.meta.env.VITE_TOKEN_WASM_HASH,
    description: 'WASM hash of the token contract',
    required: true,
  },
  // No VITE_IPFS_* entries: Pinata credentials are server-only env
  // (PINATA_API_KEY / PINATA_API_SECRET, read by api/_lib/pinata.ts). Listing
  // them here as required frontend vars is what pushed operators into baking
  // the secrets into the browser bundle (issue #921).
  {
    key: 'VITE_SENTRY_DSN',
    value: import.meta.env.VITE_SENTRY_DSN,
    description: 'Sentry DSN for error tracking (optional - production only)',
    required: false,
  },
] as const

export interface EnvValidationResult {
  valid: boolean
  missing: Array<{ key: string; description: string }>
}

export function validateEnv(): EnvValidationResult {
  const missing = ENV_VARS.filter((v) => v.required && (!v.value || v.value.trim() === '')).map(
    (v) => ({ key: v.key, description: v.description }),
  )

  return { valid: missing.length === 0, missing }
}

export function assertEnv(): void {
  const { valid, missing } = validateEnv()
  if (!valid) {
    const missingList = missing.map((m) => `  • ${m.key} — ${m.description}`).join('\n')
    throw new Error(
      `Missing required environment variables:\n\n${missingList}\n\nCopy frontend/.env.example to frontend/.env and fill in the values.`,
    )
  }
}

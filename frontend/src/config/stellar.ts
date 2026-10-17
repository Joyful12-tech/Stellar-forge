// Stellar network configuration
import { ENV } from './env'

export type Network = 'testnet' | 'mainnet' | 'standalone'

const NETWORK_LABELS: Record<Network, string> = {
  testnet: 'Testnet',
  mainnet: 'Mainnet',
  standalone: 'Standalone',
}

/** Human-readable network name for UI copy ("Testnet", "Mainnet", …). */
export function networkLabel(network: Network): string {
  return NETWORK_LABELS[network]
}

export interface NetworkConfig {
  networkPassphrase: string
  horizonUrl: string
  sorobanRpcUrl: string
}

export const NETWORK_CONFIGS: Record<Network, NetworkConfig> = {
  testnet: {
    networkPassphrase: 'Test SDF Network ; September 2015',
    horizonUrl: 'https://horizon-testnet.stellar.org',
    sorobanRpcUrl: 'https://soroban-testnet.stellar.org',
  },
  mainnet: {
    networkPassphrase: 'Public Global Stellar Network ; September 2015',
    horizonUrl: 'https://horizon.stellar.org',
    sorobanRpcUrl: 'https://soroban-mainnet.stellar.org',
  },
  standalone: {
    networkPassphrase: 'Standalone Network ; February 2017',
    horizonUrl: 'http://localhost:8000',
    sorobanRpcUrl: 'http://localhost:8000/soroban/rpc',
  },
}

const DEFAULT_NETWORK: Network = 'testnet'

function isSupportedNetwork(value: string): value is Network {
  return value in NETWORK_CONFIGS
}

// Clamp the configured network to one we have config for. An unrecognized
// VITE_NETWORK (e.g. "standalone") would otherwise leave every consumer of
// STELLAR_CONFIG[network] dereferencing undefined and crash the whole app.
export const resolvedNetwork: Network = isSupportedNetwork(ENV.network)
  ? ENV.network
  : DEFAULT_NETWORK

export const STELLAR_CONFIG = {
  network: resolvedNetwork,
  factoryContractId: ENV.factoryContractId,
  tokenWasmHash: ENV.tokenWasmHash,
  ...NETWORK_CONFIGS,
}

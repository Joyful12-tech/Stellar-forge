import type { StellarService as IStellarService } from './stellar-impl'
import type { Network } from '../config/stellar'
import { ENV, isIndexerEnabled } from '../config/env'
import {
  createFallbackTokenSource,
  createIndexerTokenSource,
  type DowngradeReason,
  type TokenSource,
} from './tokenSource'

export type { FactoryState } from '../types'

export class StellarService {
  private network: Network
  private implPromise: Promise<IStellarService> | null = null

  constructor(network: Network = 'testnet') {
    this.network = network
  }

  setNetwork(network: Network) {
    this.network = network
    this.implPromise = null
  }

  private async getImpl(): Promise<IStellarService> {
    if (!this.implPromise) {
      const { StellarService: Impl } = await import('./stellar-impl')
      this.implPromise = Promise.resolve(new Impl(this.network))
    }
    return this.implPromise
  }

  async deployToken(params: {
    name: string
    symbol: string
    decimals: number
    initialSupply: string
    maxSupply?: string | null | undefined
    salt: string
    feePayment: string
  }) {
    const impl = await this.getImpl()
    return impl.deployToken(params)
  }

  async mintTokens(params: {
    tokenAddress: string
    to: string
    amount: string
    feePayment: string
  }) {
    const impl = await this.getImpl()
    return impl.mintTokens(params)
  }

  async burnTokens(params: { tokenAddress: string; amount: string }) {
    const impl = await this.getImpl()
    return impl.burnTokens(params)
  }

  async setMetadata(params: { tokenAddress: string; metadataUri: string; feePayment: string }) {
    const impl = await this.getImpl()
    return impl.setMetadata(params)
  }

  async getTokenInfo(index: number) {
    const impl = await this.getImpl()
    return impl.getTokenInfo(index)
  }

  async getTransaction(hash: string) {
    const impl = await this.getImpl()
    return impl.getTransaction(hash)
  }

  async getFactoryState() {
    const impl = await this.getImpl()
    return impl.getFactoryState()
  }

  async accountExists(address: string) {
    const impl = await this.getImpl()
    return impl.accountExists(address)
  }

  async updateFees(params: { baseFee: string; metadataFee: string }) {
    const impl = await this.getImpl()
    return impl.updateFees(params)
  }

  async setWhitelistEnabled(enabled: boolean) {
    const impl = await this.getImpl()
    return impl.setWhitelistEnabled(enabled)
  }

  async getContractEvents(contractId: string, limit?: number, cursor?: string) {
    const impl = await this.getImpl()
    return impl.getContractEvents(contractId, limit, cursor)
  }

  /**
   * Token source used for read paths that the off-chain indexer can serve
   * (issue #943). Built lazily and only when the indexer flag is on; otherwise
   * reads go straight to RPC as before.
   */
  private async getTokenSource(): Promise<TokenSource> {
    const impl = await this.getImpl()

    // RPC is always the fallback, and the only source when the flag is off.
    const rpc: TokenSource = {
      getAllTokens: (offset, limit, tokenCountSnapshot) =>
        impl.getAllTokens(offset, limit, tokenCountSnapshot),
      getTokenInfoByAddress: (address) => impl.getTokenInfoByAddress(address),
    }

    if (!isIndexerEnabled()) return rpc

    return createFallbackTokenSource(
      createIndexerTokenSource({ baseUrl: ENV.indexerBaseUrl }),
      rpc,
      { onDowngrade: (reason) => this.onIndexerDowngrade?.(reason) },
    )
  }

  /**
   * Notified whenever a read degrades from the indexer to RPC, so the UI can
   * surface a "showing live chain data" indicator. A permanently broken
   * indexer must not be able to hide behind a working app.
   */
  onIndexerDowngrade?: (reason: DowngradeReason) => void

  async getAllTokens(offset = 0, limit = 10, tokenCountSnapshot?: number) {
    const source = await this.getTokenSource()
    return source.getAllTokens(offset, limit, tokenCountSnapshot)
  }

  async getTokensByCreator(creator: string, offset: number, limit: number) {
    const impl = await this.getImpl()
    return impl.getTokensByCreator(creator, offset, limit)
  }

  async getTokenInfoByAddress(tokenAddress: string) {
    const source = await this.getTokenSource()
    return source.getTokenInfoByAddress(tokenAddress)
  }

  async resolveTokenInfoByAddress(tokenAddress: string) {
    const impl = await this.getImpl()
    return impl.resolveTokenInfoByAddress(tokenAddress)
  }

  async getTokenEvents(tokenAddress: string) {
    const impl = await this.getImpl()
    return impl.getTokenEvents(tokenAddress)
  }
}

export const stellarService = new StellarService()

export async function buildFeeBumpTransaction(
  innerTxXdr: string,
  feeSource: string,
  network: Network,
  baseFee?: string,
): Promise<string> {
  const { buildFeeBumpTransaction: impl } = await import('./stellar-impl')
  return impl(innerTxXdr, feeSource, network, baseFee)
}

export async function submitFeeBumpTransaction(
  signedFeeBumpXdr: string,
  network: Network,
): Promise<string> {
  const { submitFeeBumpTransaction: impl } = await import('./stellar-impl')
  return impl(signedFeeBumpXdr, network)
}

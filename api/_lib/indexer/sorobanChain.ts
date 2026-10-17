/**
 * Soroban RPC implementation of the indexer's `ChainReader` (issue #943).
 *
 * Reads the factory's own view functions for backfill and its event stream for
 * steady state. Everything here is read-only: view calls go through
 * `simulateTransaction` with a throwaway source account, so no key material is
 * needed and nothing is ever submitted.
 */

import {
  Account,
  Address,
  Contract,
  nativeToScVal,
  rpc,
  scValToNative,
  TransactionBuilder,
  BASE_FEE,
  xdr,
} from 'stellar-sdk'
import type { ChainReader, EventPage, IndexerEvent } from './ingest'
import type { IndexedToken } from './types'

/**
 * Well-known all-zero account used as the source for read-only simulations.
 * `simulateTransaction` does not require the source to exist or be funded — it
 * never touches the ledger's account state for a simulation.
 */
const READONLY_SOURCE = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF'

/** `getEvents` page size. The RPC caps this server-side; 100 is the practical max. */
const EVENT_PAGE_SIZE = 100

/** Contract topic values the indexer acts on. */
const TOPIC_CREATED = 'created'
const TOPIC_META = 'meta'

export interface SorobanChainConfig {
  rpcUrl: string
  networkPassphrase: string
  factoryContractId: string
  /**
   * Ledger to start reading events from when no cursor is stored yet. Omit to
   * let the RPC start at the beginning of its retention window.
   */
  startLedger?: number | undefined
}

/** Decode a topic ScVal to its symbol/string value, or '' when undecodable. */
function topicToString(raw: string): string {
  try {
    const val = xdr.ScVal.fromXDR(raw, 'base64')
    const native = scValToNative(val)
    return typeof native === 'string' ? native : ''
  } catch {
    return ''
  }
}

export function createSorobanChainReader(config: SorobanChainConfig): ChainReader {
  const server = new rpc.Server(config.rpcUrl, {
    allowHttp: config.rpcUrl.startsWith('http://'),
  })
  const contract = new Contract(config.factoryContractId)

  /** Simulate a read-only contract call and return the decoded return value. */
  async function callView(method: string, args: xdr.ScVal[]): Promise<unknown> {
    const source = new Account(READONLY_SOURCE, '0')
    const tx = new TransactionBuilder(source, {
      fee: BASE_FEE,
      networkPassphrase: config.networkPassphrase,
    })
      .addOperation(contract.call(method, ...args))
      .setTimeout(30)
      .build()

    const sim = await server.simulateTransaction(tx)
    if (rpc.Api.isSimulationError(sim)) {
      throw new Error(`${method} simulation failed: ${sim.error}`)
    }
    if (!rpc.Api.isSimulationSuccess(sim) || !sim.result) {
      throw new Error(`${method} simulation returned no result`)
    }
    return scValToNative(sim.result.retval)
  }

  return {
    async getTokenCount(): Promise<number> {
      const state = (await callView('get_state', [])) as {
        token_count?: number | bigint
      }
      return Number(state?.token_count ?? 0)
    },

    async getTokenByIndex(index: number): Promise<IndexedToken | null> {
      let info: Record<string, unknown>
      try {
        info = (await callView('get_token_info', [
          nativeToScVal(index, { type: 'u32' }),
        ])) as Record<string, unknown>
      } catch {
        // TokenNotFound (or any read failure) for this index — the caller
        // skips it and reconciliation retries on a later run.
        return null
      }
      if (!info) return null

      // `get_token_info` is keyed by index and does not carry the token's
      // address, so resolve it through the factory's reverse mapping. A token
      // created before that mapping existed returns TokenNotFound here and is
      // skipped; `backfill_token_address` repairs those.
      const address = await resolveAddressForIndex(index)
      if (!address) return null

      return {
        address,
        tokenIndex: index,
        name: String(info['name'] ?? ''),
        symbol: String(info['symbol'] ?? ''),
        decimals: Number(info['decimals'] ?? 0),
        creator: String(info['creator'] ?? ''),
        createdAt: Number(info['created_at'] ?? 0),
        metadataUri: null,
        source: 'backfill',
      }
    },

    async getEventPage(cursor: string | null): Promise<EventPage> {
      const request: rpc.Server.GetEventsRequest = {
        filters: [{ type: 'contract', contractIds: [config.factoryContractId] }],
        limit: EVENT_PAGE_SIZE,
      }
      if (cursor) {
        request.cursor = cursor
      } else if (config.startLedger !== undefined) {
        request.startLedger = config.startLedger
      }

      const response = await server.getEvents(request)
      const events: IndexerEvent[] = []

      for (const raw of response.events ?? []) {
        // Topic layout is (factory, action, …) — the action is the second topic.
        const topics = raw.topic ?? []
        const action = topics[1] ? topicToString(topics[1].toXDR('base64')) : ''

        if (action === TOPIC_CREATED) {
          const value = scValToNative(raw.value) as unknown[]
          // `created` payload: (token_address, creator, name, symbol)
          const [address, creator, name, symbol] = value as [string, string, string, string]
          if (!address) continue
          events.push({
            type: 'created',
            token: {
              address,
              // The event does not carry the enumeration index. Resolve it so
              // keyset pagination stays aligned with contract order.
              tokenIndex: (await resolveIndexForAddress(address)) ?? 0,
              name: name ?? '',
              symbol: symbol ?? '',
              decimals: 0,
              creator: creator ?? '',
              createdAt: Math.floor(new Date(raw.ledgerClosedAt).getTime() / 1000),
              metadataUri: null,
              source: 'event',
            },
          })
        } else if (action === TOPIC_META) {
          const value = scValToNative(raw.value) as unknown[]
          // `meta` payload: (token_address, metadata_uri, version)
          const [address, uri] = value as [string, string]
          if (address && uri) events.push({ type: 'meta', address, metadataUri: uri })
        }
      }

      const latest = response.events?.[response.events.length - 1]

      return {
        events,
        // The RPC returns a cursor for the next page; a short page means we
        // have reached the head of the stream.
        cursor:
          (response.events?.length ?? 0) < EVENT_PAGE_SIZE ? null : (latest?.pagingToken ?? null),
        latestLedger: response.latestLedger ?? null,
        latestLedgerCloseTime: latest ? new Date(latest.ledgerClosedAt).getTime() : Date.now(),
      }
    },
  }

  /** `get_token_index(address) -> u32`, or null when unregistered. */
  async function resolveIndexForAddress(address: string): Promise<number | null> {
    try {
      const index = await callView('get_token_index', [new Address(address).toScVal()])
      return Number(index)
    } catch {
      return null
    }
  }

  /**
   * `get_token_address(index) -> Address`, or null when unmapped.
   *
   * This is what makes a cold backfill possible at all: without it the only
   * source of a token's address is its `created` event, which caps recovery
   * at the RPC's event-retention window — the exact truncation issue #943
   * exists to remove.
   */
  async function resolveAddressForIndex(index: number): Promise<string | null> {
    try {
      const address = await callView('get_token_address', [nativeToScVal(index, { type: 'u32' })])
      return typeof address === 'string' && address !== '' ? address : null
    } catch {
      return null
    }
  }
}

/**
 * In-memory `TokenStore`.
 *
 * Backs the ingest and API unit tests, and serves as the local-development
 * store when no `POSTGRES_URL` is configured. Deliberately not production-safe:
 * state is per-process and lost on restart, exactly like the in-memory fallback
 * in `api/_lib/rateLimit.ts`.
 */

import {
  EMPTY_STATE,
  MAX_PAGE_LIMIT,
  type IndexedToken,
  type IndexerState,
  type ListEventsOptions,
  type ListEventsResult,
  type ListTokensOptions,
  type ListTokensResult,
  type StoredEvent,
  type TokenStore,
} from './types'

export class MemoryTokenStore implements TokenStore {
  private tokens = new Map<string, IndexedToken>()
  private state: IndexerState = { ...EMPTY_STATE }
  /** Keyed by `${tokenAddress}\u0000${ledgerSeq}\u0000${topic}` to mirror the
   *  Postgres primary key, so replaying a ledger overwrites rather than
   *  duplicating. */
  private events = new Map<string, StoredEvent>()

  async upsertTokens(tokens: IndexedToken[]): Promise<void> {
    for (const token of tokens) {
      const existing = this.tokens.get(token.address)
      // Preserve a metadata URI already learned from a `meta` event when a
      // later backfill pass re-reads the token, since `get_token_info` does
      // not carry it.
      this.tokens.set(token.address, {
        ...token,
        metadataUri: token.metadataUri ?? existing?.metadataUri ?? null,
      })
    }
  }

  async setMetadataUri(address: string, metadataUri: string): Promise<void> {
    const existing = this.tokens.get(address)
    if (existing) this.tokens.set(address, { ...existing, metadataUri })
  }

  async getToken(address: string): Promise<IndexedToken | null> {
    return this.tokens.get(address) ?? null
  }

  async listTokens(options: ListTokensOptions): Promise<ListTokensResult> {
    const limit = Math.min(Math.max(options.limit, 1), MAX_PAGE_LIMIT)

    const rows = [...this.tokens.values()]
      .filter((t) => (options.creator ? t.creator === options.creator : true))
      .filter((t) => (options.cursor === undefined ? true : t.tokenIndex < options.cursor))
      .sort((a, b) => b.tokenIndex - a.tokenIndex)

    // Read one extra row to learn whether another page exists without a
    // second COUNT query.
    const page = rows.slice(0, limit)
    const hasMore = rows.length > limit
    const last = page[page.length - 1]

    return {
      tokens: page,
      nextCursor: hasMore && last ? String(last.tokenIndex) : null,
    }
  }

  async countTokens(): Promise<number> {
    return this.tokens.size
  }

  async presentIndices(indices: number[]): Promise<Set<number>> {
    const present = new Set<number>()
    const wanted = new Set(indices)
    for (const token of this.tokens.values()) {
      if (wanted.has(token.tokenIndex)) present.add(token.tokenIndex)
    }
    return present
  }

  async getState(): Promise<IndexerState> {
    return { ...this.state }
  }

  async saveState(patch: Partial<IndexerState>): Promise<void> {
    this.state = { ...this.state, ...patch }
  }

  async upsertEvents(events: StoredEvent[]): Promise<void> {
    for (const event of events) {
      this.events.set(eventKey(event.tokenAddress, event.ledgerSeq, event.topic), { ...event })
    }
  }

  async listEvents(options: ListEventsOptions): Promise<ListEventsResult> {
    const limit = Math.min(Math.max(options.limit, 1), MAX_PAGE_LIMIT)

    const rows = [...this.events.values()]
      .filter((e) => e.tokenAddress === options.tokenAddress)
      .filter((e) => (options.cursor === undefined ? true : e.ledgerSeq < options.cursor))
      .sort((a, b) => b.ledgerSeq - a.ledgerSeq || a.topic.localeCompare(b.topic))

    // Same one-extra-row trick as `listTokens`: learn whether another page
    // exists without a second pass.
    const page = rows.slice(0, limit)
    const hasMore = rows.length > limit
    const last = page[page.length - 1]

    return {
      events: page,
      nextCursor: hasMore && last ? String(last.ledgerSeq) : null,
    }
  }
}

function eventKey(tokenAddress: string, ledgerSeq: number, topic: string): string {
  return `${tokenAddress}\u0000${ledgerSeq}\u0000${topic}`
}

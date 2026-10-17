# Design: Token Search & Filtering

## Architecture Decision: Client-Side vs Indexer-Backed Search

### Option A: Client-Side Full-Fetch-Then-Filter (CHOSEN FOR MVP)

**Approach**: Fetch all pages of tokens into client state, then filter locally by name/symbol/address.

**Pros**:

- Simple: no API changes needed
- Works immediately with existing `/api/tokens?creator=` pagination
- Metadata (name, symbol) already cached in UI state after render
- Composable with existing creator filter (both applied in memory)

**Cons**:

- Doesn't scale beyond ~1000 tokens (each page load fetches 10-20 tokens, so ~100+ requests for 1000 tokens)
- Wastes bandwidth fetching all pages even if user types a specific name
- Client bears the cost of pagination traversal (keyset cursors required per page)

**Decision Rationale**: The factory currently has <100 deployed tokens in testnet. A client-side implementation handles that envelope comfortably and can be deployed immediately. Once token count exceeds 1000 and/or the indexer is confirmed stable in production (issue #1090), we backfill to Option B with an `/api/tokens?search=` parameter (no breaking change).

### Option B: Indexer-Backed Search (Future M6)

**Approach**: Add `search` query parameter to `/api/tokens?search=<name/symbol>` backed by Postgres full-text search or LIKE queries in postgresStore.ts.

**Pros**:

- Scales to any token count
- Server filters early, client receives only matches
- Composable with existing `?creator=` filter

**Cons**:

- Requires production indexer (blocked by #1090)
- Adds database load (mitigated by caching, keyset pagination)
- Adds API versioning complexity

**Deferred to**: After indexer stability is confirmed in production and token count exceeds 1000.

## Implementation (MVP — Client-Side)

### State & Input Handling

```typescript
const [nameSymbolSearch, setNameSymbolSearch] = useState('')
const debouncedNameSymbolSearch = useDebounce(nameSymbolSearch, 300)
```

### Search Function

```typescript
const getFilteredTokens = (): TokenWithMetadata[] => {
  const creatorLower = debouncedCreatorFilter.toLowerCase()
  const searchLower = debouncedNameSymbolSearch.toLowerCase()

  return tokens.filter((t) => {
    // Creator filter (existing)
    if (creatorLower && t.creator && !t.creator.toLowerCase().includes(creatorLower)) {
      return false
    }

    // Name/symbol filter (new)
    if (searchLower) {
      const nameMatch = t.metadata?.name?.toLowerCase().includes(searchLower) ?? false
      const symbolMatch = t.metadata?.symbol?.toLowerCase().includes(searchLower) ?? false
      const addressMatch = t.address.toLowerCase().includes(searchLower)
      return nameMatch || symbolMatch || addressMatch
    }

    return true
  })
}
```

### UI Components

- **Search Input**: Placed above the token list, styled consistently with existing creator filter
- **Placeholder Text**: "Search by token name, symbol, or address..."
- **Clear Button**: `x` icon to reset search
- **Results Counter**: "Showing X of Y tokens" when search is active
- **Empty State**: "No tokens match your search" distinct from "No tokens created yet"

### Metadata Handling

- Token name and symbol come from IPFS metadata (fetched via `getMetadata()`)
- Fall back to address-only search if metadata fetch fails
- Metadata cache already populated during list render via `enrichPage()`

### Composability

- Creator filter + name/symbol search are applied sequentially (both must match)
- No radio-button "search OR filter" toggle; both are always active

## Migration Path to Option B (M6+)

1. When indexer is production-ready, add `search` column(s) to Postgres schema
2. Update postgresStore.ts `listTokens()` to accept optional `search` parameter
3. Update API endpoint to accept `?search=` query param
4. Update TokenExplorer.tsx to call `/api/tokens?search=...&creator=...` instead of client-side filtering
5. Remove client-side search logic (keep structure, delegate to indexer)
6. No UI change required — component interface remains identical

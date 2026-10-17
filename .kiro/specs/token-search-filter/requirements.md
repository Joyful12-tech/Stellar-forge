# Token Search & Filtering — Requirements

## Status

**In Progress (Issue #1107)**

## Problem Statement

TokenExplorer.tsx supports only:

- Creator address substring filtering (via `getFilteredTokens()`)
- Exact token index or address lookup (via `handleSearch()`)

There is no way to search tokens by name or symbol. This is a real usability gap preventing users from discovering tokens they're interested in. The frontend currently pages tokens client-side (getAllTokens), so a naive implementation would fetch every page before filtering — this does not scale as token count grows.

The proper solution requires an architecture decision:

1. **Client-side full-fetch-then-filter** (simple, immediate, doesn't scale beyond ~1000 tokens)
2. **Indexer-backed search** via new `/api/tokens?search=` query parameter (deferred until indexer is fully production-ready and issue #1090 is confirmed closed)

## Requirements

### R1: Name & Symbol Search

Users can type a keyword to filter tokens by name or symbol (case-insensitive, substring match).

### R2: Creator Address Filtering (Existing)

Existing creator address filter continues to work and composes with name/symbol search (both applied simultaneously).

### R3: Debounced Input

Search input debounces at 300ms to avoid excessive renders or API calls.

### R4: Loading & Empty States

- **Loading state**: Show spinner while search is processing (relevant if indexer-backed)
- **Empty state**: Clear message when no tokens match combined filters (distinct from "no tokens created yet")

### R5: Searchable Metadata

Search matches against:

- Token name (from IPFS metadata)
- Token symbol (from IPFS metadata, if available)
- Token contract address (exact or prefix match)

### R6: Architecture Documentation

Document the chosen approach (client-side vs indexer) and its scaling tradeoff in code comments or design notes.

## Out of Scope

- Server-side indexer search (deferred to M6 milestone once indexer is production-ready)
- Advanced filter controls (paused/mintable state, custom properties)
- Search history or saved filters
- Token attributes beyond name/symbol/address

## Related Issues & Dependencies

- **Issue #1107**: Token Explorer has no name/symbol search (this feature)
- **Issue #1090**: Indexer cron was never scheduled (RESOLVED in M1)
- **Issue #1111**: Unused `.kiro/specs` stubs (requires backfilling this spec or removing it)
- **Deployment blocker**: Indexer-backed search requires issue #1090 to be closed and indexer running in production

# Tasks: Token Search & Filtering (MVP — Client-Side)

## Task 1: Add Search State & Input Handler

- [ ] 1.1 Add `nameSymbolSearch` state and setter to TokenExplorer.tsx
- [ ] 1.2 Create `debouncedNameSymbolSearch` using existing `useDebounce` hook (300ms)
- [ ] 1.3 Add input change handler that updates `nameSymbolSearch` state
- [ ] 1.4 Verify debouncing prevents excessive re-renders (test with React DevTools)

## Task 2: Implement Client-Side Name/Symbol Filter Logic

- [ ] 2.1 Refactor `getFilteredTokens()` to apply both creator AND name/symbol filters
- [ ] 2.2 Filter matches name field case-insensitively (substring match)
- [ ] 2.3 Filter matches symbol field case-insensitively (substring match)
- [ ] 2.4 Filter matches contract address case-insensitively (substring match)
- [ ] 2.5 All three (name, symbol, address) are OR'd together (any match returns token)
- [ ] 2.6 Creator filter and name/symbol filter are AND'd (both must match)
- [ ] 2.7 Fallback gracefully when metadata is unavailable (use address-only search)

## Task 3: Add Search UI Components

- [ ] 3.1 Add search input field above the token list
- [ ] 3.2 Placeholder text: "Search by token name, symbol, or address..."
- [ ] 3.3 Add clear button (×) that resets search when clicked
- [ ] 3.4 Style input to match existing creator filter input (use same UI components)
- [ ] 3.5 Add results counter: "Showing N of M tokens" when search is active
- [ ] 3.6 Update empty state message: distinguish "no matches" from "no tokens exist"

## Task 4: Add Loading & Empty State UX

- [ ] 4.1 Show spinner while search is debouncing (optional, high polish)
- [ ] 4.2 Show distinct empty state when no tokens match filters
- [ ] 4.3 Empty state has clear call-to-action: "Clear search" or "Browse all tokens"
- [ ] 4.4 Render behavior: if `debouncedNameSymbolSearch` is empty, show all tokens for that page
- [ ] 4.5 Pagination still works while search is active (user can page through filtered results)

## Task 5: Write Tests

- [ ] 5.1 Test exact name match (case-insensitive)
- [ ] 5.2 Test partial/substring name match
- [ ] 5.3 Test symbol match (case-insensitive)
- [ ] 5.4 Test contract address match (case-insensitive, prefix match)
- [ ] 5.5 Test combined creator + name/symbol filter (both applied)
- [ ] 5.6 Test creator filter alone (backward compatibility)
- [ ] 5.7 Test name filter alone (no creator)
- [ ] 5.8 Test empty result set (no matches)
- [ ] 5.9 Test debouncing prevents rapid filtering (timing test)
- [ ] 5.10 Test clear button resets search state
- [ ] 5.11 Test metadata unavailable fallback (search by address only)

## Task 6: Documentation & Architecture Note

- [ ] 6.1 Add code comment in `getFilteredTokens()` explaining client-side architecture choice
- [ ] 6.2 Document scaling tradeoff: "Client-side search scales to ~1000 tokens"
- [ ] 6.3 Add TODO comment linking to M6 migration path (Option B: indexer-backed search)
- [ ] 6.4 Update ISSUES.md: close issue #1107, reference this spec, link to follow-up M6 task

## Acceptance Criteria (All Must Pass)

- ✅ Users can search tokens by name (case-insensitive, substring)
- ✅ Users can search tokens by symbol (case-insensitive, substring)
- ✅ Users can search tokens by contract address
- ✅ Creator filter and name/symbol search compose correctly (AND logic)
- ✅ Search results update as user types (300ms debounce)
- ✅ Clear button resets search
- ✅ Distinct empty state when no tokens match
- ✅ All tests pass
- ✅ Architecture decision documented in code comments
- ✅ Backward compatibility: existing creator filter still works

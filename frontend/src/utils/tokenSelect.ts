/**
 * Helpers for the "pick one of my tokens, or enter an address" selector used
 * by the mint and burn forms.
 */

/** Select value meaning "the user will type a contract address instead". */
export const MANUAL_TOKEN_VALUE = '__manual__'

interface SelectableToken {
  address: string
  name: string
  symbol: string
}

/** `Name (SYM)` label for a token. */
export function tokenLabel(token: SelectableToken): string {
  return `${token.name} (${token.symbol})`
}

/** Options for the token `<Select>`: the user's tokens, then manual entry. */
export function tokenSelectOptions(tokens: SelectableToken[]): { value: string; label: string }[] {
  return [
    ...tokens.map((t) => ({ value: t.address, label: tokenLabel(t) })),
    { value: MANUAL_TOKEN_VALUE, label: 'Manual input…' },
  ]
}

/**
 * Initial select value: the address the form was opened for, else the user's
 * first token, else manual entry.
 */
export function initialTokenSelection(initialAddress: string, tokens: SelectableToken[]): string {
  return initialAddress || tokens[0]?.address || MANUAL_TOKEN_VALUE
}

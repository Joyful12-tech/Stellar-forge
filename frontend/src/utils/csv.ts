import { TransactionHistoryItem } from '../hooks/useTransactionHistory'

/**
 * Serializes transaction history items to a CSV string.
 * Columns: date, type, token, amount, tx hash
 *
 * @param transactions - List of transactions to serialize
 * @returns Standard RFC 4180 CSV string
 */
export function serializeTransactionsToCSV(transactions: TransactionHistoryItem[]): string {
  const headers = ['date', 'type', 'token', 'amount', 'tx hash']

  const rows = transactions.map((tx) => {
    const fields = [tx.date || '', tx.type || '', tx.token || '', tx.amount || '', tx.hash || '']

    return fields.map((field) => {
      let valStr = String(field)
      // Formula-injection guard (CWE-1236): spreadsheet apps execute cells
      // starting with these characters as formulas, so neutralize them with a
      // leading apostrophe before the value reaches an exported file.
      if (/^[=+\-@\t\r]/.test(valStr)) {
        valStr = `'${valStr}`
      }
      // Escape double quotes by doubling them
      const escaped = valStr.replace(/"/g, '""')
      // If the field contains commas, double quotes, or newlines, wrap it in double quotes
      if (/[",\r\n]/.test(valStr)) {
        return `"${escaped}"`
      }
      return valStr
    })
  })

  return [headers, ...rows].map((row) => row.join(',')).join('\n')
}

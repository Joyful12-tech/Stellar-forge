import { Page } from '@playwright/test'

/**
 * Shape of the `networkDetails` payload Freighter reports back over the
 * postMessage channel. Mirrors `frontend/src/config/stellar.ts`'s
 * `NETWORK_CONFIGS` entries so mocked responses match what the real
 * extension would send for a given network.
 */
export interface MockNetworkDetails {
  network: string
  networkUrl: string
  networkPassphrase: string
  sorobanRpcUrl: string
}

export const FREIGHTER_TESTNET: MockNetworkDetails = {
  network: 'TESTNET',
  networkUrl: 'https://horizon-testnet.stellar.org',
  networkPassphrase: 'Test SDF Network ; September 2015',
  sorobanRpcUrl: 'https://soroban-testnet.stellar.org',
}

export const FREIGHTER_MAINNET: MockNetworkDetails = {
  network: 'PUBLIC',
  networkUrl: 'https://horizon.stellar.org',
  networkPassphrase: 'Public Global Stellar Network ; September 2015',
  sorobanRpcUrl: 'https://soroban-mainnet.stellar.org',
}

/**
 * Mocks the Freighter wallet for E2E tests.
 *
 * `@stellar/freighter-api` talks to the browser extension over a
 * `window.postMessage` request/response channel — it does NOT call methods on a
 * `window.freighter` object. So we:
 *   1. set `window.freighter = true` so `isConnected()` reports the wallet as
 *      installed (the api short-circuits on this flag), and
 *   2. answer the `FREIGHTER_EXTERNAL_MSG_REQUEST` messages the api posts with a
 *      matching `FREIGHTER_EXTERNAL_MSG_RESPONSE` carrying the mock account.
 *
 * @param networkDetails The network Freighter reports itself as being on.
 *   Defaults to TESTNET (the app's default network) so existing callers are
 *   unaffected. Pass FREIGHTER_MAINNET (or a custom value) to simulate the
 *   wallet being on a different network than the app expects.
 */
export async function mockFreighter(
  page: Page,
  address: string,
  networkDetails: MockNetworkDetails = FREIGHTER_TESTNET,
) {
  await page.addInitScript(
    ({
      mockAddress,
      mockNetworkDetails,
    }: {
      mockAddress: string
      mockNetworkDetails: MockNetworkDetails
    }) => {
      // Marks Freighter as installed for isConnected().
      ;(window as unknown as { freighter: boolean }).freighter = true

      window.addEventListener('message', (event: MessageEvent) => {
        const req = event.data
        if (!req || req.source !== 'FREIGHTER_EXTERNAL_MSG_REQUEST') return

        // Build the response payload for the requested operation.
        const payload: Record<string, unknown> = {}
        switch (req.type) {
          case 'REQUEST_CONNECTION_STATUS':
            payload.isConnected = true
            break
          case 'REQUEST_ACCESS':
          case 'REQUEST_PUBLIC_KEY':
            payload.publicKey = mockAddress
            break
          case 'REQUEST_NETWORK':
          case 'REQUEST_NETWORK_DETAILS':
            // The api reads a nested `networkDetails` object off the response.
            payload.networkDetails = {
              network: mockNetworkDetails.network,
              networkName: mockNetworkDetails.network,
              networkUrl: mockNetworkDetails.networkUrl,
              networkPassphrase: mockNetworkDetails.networkPassphrase,
              sorobanRpcUrl: mockNetworkDetails.sorobanRpcUrl,
            }
            break
          case 'REQUEST_ALLOWED_STATUS':
          case 'SET_ALLOWED_STATUS':
            payload.isAllowed = true
            break
          case 'SUBMIT_TRANSACTION':
            // Echo the XDR back as the "signed" transaction.
            payload.signedTransaction = req.transactionXdr
            payload.signerAddress = mockAddress
            break
          case 'REQUEST_USER_INFO':
            payload.userInfo = { publicKey: mockAddress }
            break
          default:
            break
        }

        // The api matches responses on `messagedId` (note the upstream typo) and
        // requires this exact source string.
        window.postMessage(
          {
            source: 'FREIGHTER_EXTERNAL_MSG_RESPONSE',
            messagedId: req.messageId,
            ...payload,
          },
          window.location.origin,
        )
      })
    },
    { mockAddress: address, mockNetworkDetails: networkDetails },
  )
}

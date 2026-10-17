// e2e/support/rpc-mocks.ts
import { Page } from '@playwright/test'
import { Address, nativeToScVal, xdr } from 'stellar-sdk'

/**
 * Build a mock ScVal representing the factory state.
 * Adjust the fields to match your actual contract's get_state() return type.
 */
function buildMockFactoryState(factoryAddress: string, tokenCount: number = 5) {
  const admin = Address.fromString(factoryAddress) // or a test address
  // Deterministic test address (Keypair.fromRawEd25519Seed of 0x02 bytes).
  const treasury = Address.fromString('GCATS5YOVB6ROX2WUNKGNQ2MP3GMXDMKSG2O4N5CLX3A6W4PZGZZI55U')

  const entries = [
    new xdr.ScMapEntry({
      key: nativeToScVal('admin', { type: 'symbol' }),
      val: admin.toScVal(),
    }),
    new xdr.ScMapEntry({
      key: nativeToScVal('treasury', { type: 'symbol' }),
      val: treasury.toScVal(),
    }),
    new xdr.ScMapEntry({
      key: nativeToScVal('base_fee', { type: 'symbol' }),
      val: nativeToScVal(100_000, { type: 'i128' }),
    }),
    new xdr.ScMapEntry({
      key: nativeToScVal('metadata_fee', { type: 'symbol' }),
      val: nativeToScVal(50_000, { type: 'i128' }),
    }),
    new xdr.ScMapEntry({
      key: nativeToScVal('token_count', { type: 'symbol' }),
      val: nativeToScVal(tokenCount, { type: 'u32' }),
    }),
    new xdr.ScMapEntry({
      key: nativeToScVal('paused', { type: 'symbol' }),
      val: nativeToScVal(false, { type: 'bool' }),
    }),
  ]

  return xdr.ScVal.scvMap(entries)
}

/**
 * Build a mock `simulateTransaction` response.
 * The `retval` must be a base64-encoded ScVal.
 */
function buildMockSimulateResult(factoryAddress: string, tokenCount: number = 5) {
  const scVal = buildMockFactoryState(factoryAddress, tokenCount)
  return {
    retval: scVal.toXDR('base64'),
    // You may also need to include auth, footprint, etc. – minimal for this test.
  }
}

/**
 * Build mock events for `getEvents` (e.g., token created events).
 * Adjust topics and data to match your contract's events.
 */
function buildMockEvents(factoryAddress: string, tokenAddress: string) {
  const tokenCreatedTopic = nativeToScVal('token_created', { type: 'symbol' })
  // Simulate one event
  return [
    {
      type: 'contract',
      contractId: factoryAddress,
      ledger: 123456,
      topic: [tokenCreatedTopic.toXDR('base64')],
      data: {
        value: {
          token: Address.fromString(tokenAddress).toScVal().toXDR('base64'),
          owner: Address.fromString('GCATS5YOVB6ROX2WUNKGNQ2MP3GMXDMKSG2O4N5CLX3A6W4PZGZZI55U')
            .toScVal()
            .toXDR('base64'),
          // ... other fields as needed
        },
      },
    },
  ]
}

/**
 * Intercept all RPC requests to the Soroban endpoint and return mock responses.
 * @param page Playwright page
 * @param factoryAddress The factory contract ID (used in mocks)
 * @param tokenAddress A dummy token address (used in event mocks)
 * @param tokenCount Number of tokens returned in state
 */
export async function mockSorobanRpc(
  page: Page,
  factoryAddress: string,
  tokenAddress: string,
  tokenCount: number = 5,
) {
  // Determine the RPC URL from your config – you can hardcode or read from localStorage.
  // NetworkContext stores the network JSON-encoded (e.g. '"testnet"').
  const appNetwork = await page.evaluate(() =>
    (localStorage.getItem('stellarforge_network') || 'testnet').replace(/"/g, ''),
  )
  const rpcUrl =
    appNetwork.toLowerCase() === 'testnet'
      ? 'https://soroban-testnet.stellar.org'
      : 'https://soroban-mainnet.stellar.org'

  await page.route(rpcUrl, async (route) => {
    const request = route.request()
    const postData = request.postDataJSON()
    if (!postData || postData.jsonrpc !== '2.0') {
      await route.continue()
      return
    }

    const method = postData.method
    const id = postData.id

    if (method === 'simulateTransaction') {
      // Return mock simulation
      const mockResult = buildMockSimulateResult(factoryAddress, tokenCount)
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          jsonrpc: '2.0',
          id,
          result: mockResult,
        }),
      })
      return
    }

    if (method === 'getEvents') {
      const mockEvents = buildMockEvents(factoryAddress, tokenAddress)
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          jsonrpc: '2.0',
          id,
          result: { events: mockEvents },
        }),
      })
      return
    }

    // For other methods, pass through (or mock as needed)
    await route.continue()
  })
}

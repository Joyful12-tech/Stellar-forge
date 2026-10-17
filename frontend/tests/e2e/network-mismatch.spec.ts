// e2e/network-mismatch.spec.ts
import { test, expect, Page } from '@playwright/test'
import { mockSorobanRpc } from './helpers/rpc-mocks'
import { mockIpfsHealth } from './helpers/api-mocks'
import { FREIGHTER_MAINNET, FREIGHTER_TESTNET, mockFreighter } from './helpers/wallet-mock'

const APP_URL = '/'
// Deterministic test identities (Keypair.fromRawEd25519Seed of 0x01/0x03 bytes).
const USER_ADDRESS = 'GCFIRY65OQE7DFP5KLNS2PF2LVZMUZYJX4OZIEQ36N2IQANUB5XVYOJR'
const FACTORY_CONTRACT = 'CABQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGCK3'
const TOKEN_CONTRACT = 'CABQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGCK3'

/**
 * The wallet mock auto-connects, which makes the forms run their XLM balance
 * check against Horizon. Stub the account endpoint with a healthy native
 * balance so `useBalanceCheck` doesn't disable submit buttons for reasons
 * unrelated to the network guard under test.
 */
async function mockHorizonBalance(page: Page, xlm = '10000.0000000') {
  await page.route('**/accounts/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: USER_ADDRESS,
        account_id: USER_ADDRESS,
        sequence: '1',
        balances: [{ asset_type: 'native', balance: xlm }],
      }),
    })
  })
}

/**
 * Load the app and navigate to a route via its nav link. Routes like /mint are
 * behind ProtectedRoute, which redirects to "/" until the (mocked) wallet has
 * auto-connected — so wait for the connected state before navigating.
 */
async function openRoute(page: Page, navLink: string) {
  await page.goto(APP_URL)
  await expect(page.getByRole('button', { name: 'Disconnect' })).toBeVisible()
  await page.getByRole('link', { name: navLink, exact: true }).click()
}

test.describe('Network Mismatch Guard', () => {
  test.beforeEach(async ({ page }) => {
    // Set the app's expected network to testnet. NetworkContext persists via
    // useLocalStorage, which JSON-encodes values — store it the same way.
    await page.goto(APP_URL)
    await page.evaluate(() => {
      localStorage.setItem('stellarforge_network', JSON.stringify('testnet'))
    })
    // Mock the RPC to avoid real calls
    await mockSorobanRpc(page, FACTORY_CONTRACT, TOKEN_CONTRACT)
    await mockHorizonBalance(page)
    // MetadataForm renders its upload-readiness panel instead of the form
    // until the server says pinning is available; the static E2E build has no
    // API behind it to say so.
    await mockIpfsHealth(page)
  })

  test('should block MintForm when Freighter is on MAINNET', async ({ page }) => {
    await mockFreighter(page, USER_ADDRESS, FREIGHTER_MAINNET)
    await openRoute(page, 'Mint')
    await page.waitForSelector('button[type="submit"]')
    const submitBtn = page.locator('button[type="submit"]')
    await expect(submitBtn).toBeDisabled()
    // Also check for a warning message (if present)
    const warning = page.locator('text=Network mismatch')
    await expect(warning).toBeVisible()
  })

  test('should block BurnForm when Freighter is on MAINNET', async ({ page }) => {
    await mockFreighter(page, USER_ADDRESS, FREIGHTER_MAINNET)
    await openRoute(page, 'Burn')
    await page.waitForSelector('button[type="submit"]')
    await expect(page.locator('button[type="submit"]')).toBeDisabled()
  })

  test('should block MetadataForm when Freighter is on MAINNET', async ({ page }) => {
    await mockFreighter(page, USER_ADDRESS, FREIGHTER_MAINNET)
    await openRoute(page, 'Metadata')
    await page.waitForSelector('button[type="submit"]')
    await expect(page.locator('button[type="submit"]')).toBeDisabled()
  })

  // AdminPanel only renders its actions when the connected wallet matches the
  // factory admin from get_state(), and the mocked simulateTransaction
  // response is not yet shaped so stellar-sdk can parse it (needs
  // results[].xdr + transactionData, plus a getLedgerEntries mock for
  // getAccount). Until that mock infrastructure exists this cannot render the
  // panel at all; the guard itself (useNetworkGuard) is shared with the forms
  // covered above.
  test.fixme('should block AdminPanel actions when Freighter is on MAINNET', async ({ page }) => {
    await mockFreighter(page, USER_ADDRESS, FREIGHTER_MAINNET)
    await page.goto('/admin')
    await page.waitForSelector('button:has-text("Execute")')
    await expect(page.locator('button:has-text("Execute")')).toBeDisabled()
  })

  test('should block CreateToken (via TokenForm) when Freighter is on MAINNET', async ({
    page,
  }) => {
    await mockFreighter(page, USER_ADDRESS, FREIGHTER_MAINNET)
    await openRoute(page, 'Create')
    // TokenForm renders inside the CreateToken route; its submit button is disabled.
    await page.waitForSelector('button[type="submit"]')
    await expect(page.locator('button[type="submit"]')).toBeDisabled()
  })

  test('should allow all forms when Freighter matches the app network (TESTNET)', async ({
    page,
  }) => {
    // Default mock uses TESTNET
    await mockFreighter(page, USER_ADDRESS, FREIGHTER_TESTNET)
    await openRoute(page, 'Mint')
    await page.waitForSelector('button[type="submit"]')
    // MintForm's submit is gated on the network guard and the balance check
    // (mocked healthy above) — with both green it must be clickable.
    await expect(page.locator('button[type="submit"]')).toBeEnabled()
    // And the mismatch warning must not be shown.
    await expect(page.locator('text=Network mismatch')).toHaveCount(0)
  })
})

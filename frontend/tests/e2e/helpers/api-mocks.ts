import type { Page } from '@playwright/test'

/**
 * Stub `GET /api/health/ipfs`, the endpoint the app asks whether this
 * deployment can pin to IPFS (issue #921 — the credentials live in server env,
 * so the browser cannot answer this itself).
 *
 * The E2E job serves a static build with no serverless functions behind it, so
 * the probe would otherwise fail and every upload-capable form would render its
 * "uploads are disabled" panel instead of the form. Specs that are testing
 * something else entirely — the network guard, say — need the form on screen,
 * exactly like `mockHorizonBalance` keeps the balance check from disabling
 * buttons for unrelated reasons.
 */
export async function mockIpfsHealth(page: Page, configured = true) {
  await page.route('**/api/health/ipfs', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ configured }),
    })
  })
}

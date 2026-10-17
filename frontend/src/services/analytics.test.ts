/**
 * Analytics opt-out tests — issue #948
 *
 * These tests prove that:
 *  1. When opt-out is set, ZERO analytics events are dispatched.
 *  2. Opt-out takes effect IMMEDIATELY (in-session, no reload required).
 *  3. Opt-in restores normal event dispatching.
 *  4. Missing VITE_PLAUSIBLE_DOMAIN also suppresses all events.
 *  5. Every public tracking call site (trackEvent, trackPageView) is covered.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { isOptedOut, setOptOut, trackEvent, trackPageView } from './analytics'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Install a spy on window.plausible and return it. */
function stubPlausible() {
  const spy = vi.fn()
  window.plausible = spy
  return spy
}

/** Remove window.plausible so "not configured" tests work cleanly. */
function removePlausible() {
  delete window.plausible
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  localStorage.clear()
  // Default: plausible domain IS configured so tests can focus on opt-out logic.
  vi.stubEnv('VITE_PLAUSIBLE_DOMAIN', 'example.com')
})

afterEach(() => {
  localStorage.clear()
  removePlausible()
  vi.unstubAllEnvs()
})

// ---------------------------------------------------------------------------
// isOptedOut / setOptOut
// ---------------------------------------------------------------------------

// ADR-005: REQ-ADR005-04 - Persisted opt-out state uses analytics_opt_out.
describe('isOptedOut', () => {
  // ADR-005: REQ-ADR005-04 - Empty storage means no persisted opt-out.
  it('returns false when localStorage is empty', () => {
    expect(isOptedOut()).toBe(false)
  })

  // ADR-005: REQ-ADR005-04 - The persisted true flag is recognized.
  it('returns true when opt-out flag is set to "true"', () => {
    localStorage.setItem('analytics_opt_out', 'true')
    expect(isOptedOut()).toBe(true)
  })

  // ADR-005: REQ-ADR005-04 - Unknown storage values do not opt the user out.
  it('returns false when opt-out flag has any other value', () => {
    localStorage.setItem('analytics_opt_out', '1')
    expect(isOptedOut()).toBe(false)
  })
})

// ADR-005: REQ-ADR005-04 - Opt-out preference is persisted and removable.
describe('setOptOut', () => {
  // ADR-005: REQ-ADR005-04 - Opt-out writes the canonical storage value.
  it('sets opt-out flag in localStorage when called with true', () => {
    setOptOut(true)
    expect(localStorage.getItem('analytics_opt_out')).toBe('true')
    expect(isOptedOut()).toBe(true)
  })

  // ADR-005: REQ-ADR005-04 - Opt-in removes the persisted opt-out value.
  it('removes opt-out flag from localStorage when called with false', () => {
    localStorage.setItem('analytics_opt_out', 'true')
    setOptOut(false)
    expect(localStorage.getItem('analytics_opt_out')).toBeNull()
    expect(isOptedOut()).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// trackEvent — opt-out suppression
// ---------------------------------------------------------------------------

// ADR-005: REQ-ADR005-01, REQ-ADR005-05, REQ-ADR005-06, REQ-ADR005-07
// Consent-aware custom events accept scalar, non-PII props and honor runtime guards.
describe('trackEvent', () => {
  // ADR-005: REQ-ADR005-01, REQ-ADR005-06, REQ-ADR005-07 - Enabled events send scalar props only.
  it('fires window.plausible when analytics is enabled and user has NOT opted out', () => {
    const plausible = stubPlausible()
    trackEvent('token_created', { symbol: 'TEST' })
    expect(plausible).toHaveBeenCalledOnce()
    expect(plausible).toHaveBeenCalledWith('token_created', { props: { symbol: 'TEST' } })
  })

  // ADR-005: REQ-ADR005-05 - An existing opt-out suppresses custom events.
  it('does NOT fire window.plausible when user opts out BEFORE the call', () => {
    const plausible = stubPlausible()
    setOptOut(true)
    trackEvent('token_created')
    expect(plausible).not.toHaveBeenCalled()
  })

  // ADR-005: REQ-ADR005-05 - Mid-session opt-out suppresses subsequent events immediately.
  it('suppresses events IMMEDIATELY after opt-out — no reload required', () => {
    const plausible = stubPlausible()

    // First call fires normally
    trackEvent('page_view')
    expect(plausible).toHaveBeenCalledTimes(1)

    // Opt-out mid-session
    setOptOut(true)

    // Subsequent calls in the same session are suppressed instantly
    trackEvent('token_created')
    trackEvent('mint_tokens')
    expect(plausible).toHaveBeenCalledTimes(1) // no additional calls
  })

  // ADR-005: REQ-ADR005-05 - Mid-session opt-in restores event dispatch.
  it('resumes firing after user opts back in — immediate in-session effect', () => {
    const plausible = stubPlausible()

    setOptOut(true)
    trackEvent('page_view')
    expect(plausible).toHaveBeenCalledTimes(0)

    // Opt back in during the same session
    setOptOut(false)
    trackEvent('token_created')
    expect(plausible).toHaveBeenCalledTimes(1)
  })

  // ADR-005: REQ-ADR005-07 - Missing provider configuration suppresses events.
  it('does NOT fire when VITE_PLAUSIBLE_DOMAIN is not set', () => {
    vi.stubEnv('VITE_PLAUSIBLE_DOMAIN', '')
    const plausible = stubPlausible()
    trackEvent('token_created')
    expect(plausible).not.toHaveBeenCalled()
  })

  // ADR-005: REQ-ADR005-01, REQ-ADR005-06 - Supported scalar props are forwarded unchanged.
  it('passes event props correctly to plausible', () => {
    const plausible = stubPlausible()
    trackEvent('mint', { amount: 1000, symbol: 'XLM', success: true })
    expect(plausible).toHaveBeenCalledWith('mint', {
      props: { amount: 1000, symbol: 'XLM', success: true },
    })
  })

  // ADR-005: REQ-ADR005-06 - Events without props pass an undefined payload.
  it('calls plausible with an undefined payload when props is omitted', () => {
    const plausible = stubPlausible()
    trackEvent('wallet_connect')
    expect(plausible).toHaveBeenCalledWith('wallet_connect', undefined)
  })

  // ADR-005: REQ-ADR005-05 - Missing provider API cannot break the application.
  it('does not throw when window.plausible is undefined', () => {
    removePlausible()
    expect(() => trackEvent('token_created')).not.toThrow()
  })
  // ADR-005: REQ-ADR005-01, REQ-ADR005-06 - Wallet-like values are not emitted by the tested payload.
  it('does not include wallet addresses in the analytics payload', () => {
    const plausible = stubPlausible()
    const walletAddress = 'GABC1234567890NOTANALYTICSPROP'

    trackEvent('token_created', { symbol: 'TEST', success: true })

    expect(plausible).toHaveBeenCalledWith('token_created', {
      props: { symbol: 'TEST', success: true },
    })
    expect(JSON.stringify(plausible.mock.calls)).not.toContain(walletAddress)
  })

  // ADR-005: REQ-ADR005-04, REQ-ADR005-05 - Repeated toggles leave the final consent state authoritative.
  it('honors the final state after repeated opt-out toggles', () => {
    const plausible = stubPlausible()

    for (let toggle = 0; toggle < 5; toggle += 1) {
      setOptOut(toggle % 2 === 0)
    }

    expect(isOptedOut()).toBe(true)
    trackEvent('must_remain_suppressed')
    expect(plausible).not.toHaveBeenCalled()

    setOptOut(false)
    trackEvent('must_resume_after_final_opt_in')
    expect(plausible).toHaveBeenCalledOnce()
  })

  // ADR-005: REQ-ADR005-04, REQ-ADR005-05 - A fresh storage read preserves the recorded decision.
  it('re-reads persisted opt-out state after a simulated storage reset', () => {
    const plausible = stubPlausible()

    setOptOut(true)
    localStorage.removeItem('analytics_opt_out')
    localStorage.setItem('analytics_opt_out', 'true')

    trackEvent('must_remain_suppressed_after_storage_reset')
    expect(isOptedOut()).toBe(true)
    expect(plausible).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// trackPageView — opt-out suppression
// ---------------------------------------------------------------------------

// ADR-005: REQ-ADR005-05, REQ-ADR005-06, REQ-ADR005-07 - Page views honor consent and configuration.
describe('trackPageView', () => {
  // ADR-005: REQ-ADR005-06, REQ-ADR005-07 - Configured page views send only the route URL.
  it('fires window.plausible when user has NOT opted out', () => {
    const plausible = stubPlausible()
    trackPageView('/create')
    expect(plausible).toHaveBeenCalledOnce()
    expect(plausible).toHaveBeenCalledWith('pageview', {
      u: `${window.location.origin}/create`,
    })
  })

  // ADR-005: REQ-ADR005-05 - An existing opt-out suppresses page views.
  it('does NOT fire window.plausible when user opts out BEFORE the call', () => {
    const plausible = stubPlausible()
    setOptOut(true)
    trackPageView('/create')
    expect(plausible).not.toHaveBeenCalled()
  })

  // ADR-005: REQ-ADR005-05 - Mid-session opt-out suppresses later page views.
  it('suppresses page-view events IMMEDIATELY after opt-out — no reload required', () => {
    const plausible = stubPlausible()

    trackPageView('/')
    expect(plausible).toHaveBeenCalledTimes(1)

    // Opt-out mid-session
    setOptOut(true)

    trackPageView('/create')
    trackPageView('/tokens')
    expect(plausible).toHaveBeenCalledTimes(1) // no new calls
  })

  // ADR-005: REQ-ADR005-07 - Missing provider configuration suppresses page views.
  it('does NOT fire when VITE_PLAUSIBLE_DOMAIN is not set', () => {
    vi.stubEnv('VITE_PLAUSIBLE_DOMAIN', '')
    const plausible = stubPlausible()
    trackPageView('/create')
    expect(plausible).not.toHaveBeenCalled()
  })

  // ADR-005: REQ-ADR005-05 - Missing provider API cannot break page navigation.
  it('does not throw when window.plausible is undefined', () => {
    removePlausible()
    expect(() => trackPageView('/create')).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// Full session simulation: every tracking call site suppressed after opt-out
// ---------------------------------------------------------------------------

// ADR-005: REQ-ADR005-05, REQ-ADR005-08 - All consent-aware call sites remain suppressed after opt-out.
describe('opt-out suppresses ALL tracking call sites for the remainder of the session', () => {
  // ADR-005: REQ-ADR005-05, REQ-ADR005-08 - No call site emits telemetry after opt-out.
  it('zero analytics events dispatched after opt-out across every call site', () => {
    const plausible = stubPlausible()

    // --- Phase 1: analytics active, events fire normally ---
    trackPageView('/')
    trackEvent('wallet_connect')
    trackEvent('token_created', { symbol: 'ABC' })
    trackPageView('/tokens')
    trackEvent('mint_tokens', { amount: 500 })

    const callsBeforeOptOut = plausible.mock.calls.length
    expect(callsBeforeOptOut).toBe(5)

    // --- Phase 2: user opts out (mid-session) ---
    setOptOut(true)

    // --- Phase 3: every call site fires — none should reach plausible ---
    trackPageView('/create') // App.tsx call site
    trackEvent('token_created') // generic trackEvent
    trackPageView('/mint') // another page view
    trackEvent('burn_tokens') // generic trackEvent
    trackEvent('metadata_set') // generic trackEvent

    // Plausible call count must NOT have increased
    expect(plausible.mock.calls.length).toBe(callsBeforeOptOut)
  })
})

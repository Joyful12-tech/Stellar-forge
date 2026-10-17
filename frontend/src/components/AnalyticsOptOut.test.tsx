/**
 * AnalyticsOptOut component tests — issue #948
 *
 * Verifies that the opt-out checkbox:
 *  - Renders only when VITE_PLAUSIBLE_DOMAIN is configured.
 *  - Correctly reflects the current opt-out state.
 *  - Toggles opt-out on change and suppresses events immediately.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AnalyticsOptOut } from './AnalyticsOptOut'
import { isOptedOut, trackEvent } from '../services/analytics'

beforeEach(() => {
  localStorage.clear()
  vi.stubEnv('VITE_PLAUSIBLE_DOMAIN', 'example.com')
})

afterEach(() => {
  localStorage.clear()
  delete window.plausible
  vi.unstubAllEnvs()
})

describe('AnalyticsOptOut component', () => {
  // ADR-005: REQ-ADR005-03, REQ-ADR005-07 - The control follows analytics configuration.
  // ADR-005: REQ-ADR005-03, REQ-ADR005-07 - Configured analytics exposes the opt-out control.
  it('renders the opt-out checkbox when VITE_PLAUSIBLE_DOMAIN is set', () => {
    render(<AnalyticsOptOut />)
    expect(screen.getByRole('checkbox', { name: /opt out of analytics/i })).toBeInTheDocument()
  })

  // ADR-005: REQ-ADR005-07 - Unconfigured analytics exposes no opt-out control.
  it('renders nothing when VITE_PLAUSIBLE_DOMAIN is not configured', () => {
    vi.stubEnv('VITE_PLAUSIBLE_DOMAIN', '')
    const { container } = render(<AnalyticsOptOut />)
    expect(container.firstChild).toBeNull()
  })

  // ADR-005: REQ-ADR005-03, REQ-ADR005-04 - The control reflects persisted consent state.
  // ADR-005: REQ-ADR005-03, REQ-ADR005-04 - The unchecked control reflects absent opt-out state.
  it('checkbox is unchecked when user has NOT opted out', () => {
    render(<AnalyticsOptOut />)
    const checkbox = screen.getByRole('checkbox', { name: /opt out of analytics/i })
    expect(checkbox).not.toBeChecked()
  })

  // ADR-005: REQ-ADR005-03, REQ-ADR005-04 - The checked control reflects persisted opt-out state.
  it('checkbox is checked when user HAS opted out (persisted in localStorage)', () => {
    localStorage.setItem('analytics_opt_out', 'true')
    render(<AnalyticsOptOut />)
    const checkbox = screen.getByRole('checkbox', { name: /opt out of analytics/i })
    expect(checkbox).toBeChecked()
  })

  // ADR-005: REQ-ADR005-04, REQ-ADR005-05 - UI changes persist and apply immediately.
  // ADR-005: REQ-ADR005-04, REQ-ADR005-05 - Checking persists and applies opt-out immediately.
  it('checking the checkbox opts the user out immediately (persisted + service updated)', () => {
    render(<AnalyticsOptOut />)
    const checkbox = screen.getByRole('checkbox', { name: /opt out of analytics/i })

    fireEvent.click(checkbox)

    expect(checkbox).toBeChecked()
    expect(isOptedOut()).toBe(true)
    expect(localStorage.getItem('analytics_opt_out')).toBe('true')
  })

  // ADR-005: REQ-ADR005-04, REQ-ADR005-05 - Unchecking removes persistence and restores opt-in.
  it('un-checking the checkbox opts the user back in immediately', () => {
    localStorage.setItem('analytics_opt_out', 'true')
    render(<AnalyticsOptOut />)
    const checkbox = screen.getByRole('checkbox', { name: /opt out of analytics/i })

    fireEvent.click(checkbox)

    expect(checkbox).not.toBeChecked()
    expect(isOptedOut()).toBe(false)
    expect(localStorage.getItem('analytics_opt_out')).toBeNull()
  })

  // ADR-005: REQ-ADR005-05, REQ-ADR005-08 - UI opt-out blocks subsequent tracking calls.
  // ADR-005: REQ-ADR005-05, REQ-ADR005-08 - UI opt-out blocks all subsequent tracking.
  it('analytics events are suppressed immediately after checking the opt-out box — no reload required', () => {
    const plausible = vi.fn()
    window.plausible = plausible

    render(<AnalyticsOptOut />)
    const checkbox = screen.getByRole('checkbox', { name: /opt out of analytics/i })

    // Opt out via UI
    fireEvent.click(checkbox)

    // Any tracking call fired in the same session is suppressed
    trackEvent('should_be_suppressed')
    expect(plausible).not.toHaveBeenCalled()
  })

  // ADR-005: REQ-ADR005-05 - UI opt-in restores tracking immediately.
  it('analytics events fire again after un-checking the opt-out box', () => {
    localStorage.setItem('analytics_opt_out', 'true')
    const plausible = vi.fn()
    window.plausible = plausible

    render(<AnalyticsOptOut />)
    const checkbox = screen.getByRole('checkbox', { name: /opt out of analytics/i })

    // Opt back in via UI
    fireEvent.click(checkbox)

    trackEvent('should_fire')
    expect(plausible).toHaveBeenCalledOnce()
  })

  // ADR-005: REQ-ADR005-03 - Opt-out control exposes an accessible name.
  // ADR-005: REQ-ADR005-03 - The control has an accessible label.
  it('has an accessible aria-label on the checkbox', () => {
    render(<AnalyticsOptOut />)
    const checkbox = screen.getByRole('checkbox', { name: /opt out of analytics/i })
    expect(checkbox).toHaveAttribute('aria-label', 'Opt out of analytics')
  })
})

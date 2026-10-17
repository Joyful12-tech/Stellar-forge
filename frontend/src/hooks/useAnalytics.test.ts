/**
 * useAnalytics hook tests — issue #948
 *
 * Verifies that the React hook correctly reflects and toggles the opt-out
 * state and that the change propagates synchronously to the analytics service
 * (i.e. takes effect in-session without a reload).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAnalytics } from './useAnalytics'
import { isOptedOut, trackEvent } from '../services/analytics'

beforeEach(() => {
  localStorage.clear()
  vi.stubEnv('VITE_PLAUSIBLE_DOMAIN', 'example.com')
})

afterEach(() => {
  localStorage.clear()
  vi.unstubAllEnvs()
})

describe('useAnalytics', () => {
  it('initialises with optedOut = false when localStorage is empty', () => {
    const { result } = renderHook(() => useAnalytics())
    expect(result.current.optedOut).toBe(false)
  })

  it('initialises with optedOut = true when opt-out flag is already set', () => {
    localStorage.setItem('analytics_opt_out', 'true')
    const { result } = renderHook(() => useAnalytics())
    expect(result.current.optedOut).toBe(true)
  })

  it('toggleOptOut sets opt-out to true and persists to localStorage', () => {
    const { result } = renderHook(() => useAnalytics())

    act(() => {
      result.current.toggleOptOut()
    })

    expect(result.current.optedOut).toBe(true)
    expect(localStorage.getItem('analytics_opt_out')).toBe('true')
  })

  it('toggleOptOut sets opt-out back to false and clears localStorage', () => {
    localStorage.setItem('analytics_opt_out', 'true')
    const { result } = renderHook(() => useAnalytics())
    expect(result.current.optedOut).toBe(true)

    act(() => {
      result.current.toggleOptOut()
    })

    expect(result.current.optedOut).toBe(false)
    expect(localStorage.getItem('analytics_opt_out')).toBeNull()
  })

  it('opt-out takes effect IMMEDIATELY in the same session — analytics service is updated synchronously', () => {
    const plausible = vi.fn()
    window.plausible = plausible

    const { result } = renderHook(() => useAnalytics())
    expect(result.current.optedOut).toBe(false)

    // Trigger opt-out
    act(() => {
      result.current.toggleOptOut()
    })

    // The analytics service should now report opted-out without any reload
    expect(isOptedOut()).toBe(true)

    // Any tracking call fired after the toggle must be suppressed
    trackEvent('should_be_suppressed')
    expect(plausible).not.toHaveBeenCalled()

    delete window.plausible
  })

  it('re-enabling tracking via toggleOptOut allows events to fire again', () => {
    localStorage.setItem('analytics_opt_out', 'true')
    const plausible = vi.fn()
    window.plausible = plausible

    const { result } = renderHook(() => useAnalytics())

    // Opt back in
    act(() => {
      result.current.toggleOptOut()
    })

    expect(result.current.optedOut).toBe(false)
    expect(isOptedOut()).toBe(false)

    trackEvent('should_fire')
    expect(plausible).toHaveBeenCalledOnce()

    delete window.plausible
  })

  it('isOptedOut service state matches hook state after toggle', () => {
    const { result } = renderHook(() => useAnalytics())

    act(() => {
      result.current.toggleOptOut()
    })
    expect(isOptedOut()).toBe(result.current.optedOut)

    act(() => {
      result.current.toggleOptOut()
    })
    expect(isOptedOut()).toBe(result.current.optedOut)
  })
})

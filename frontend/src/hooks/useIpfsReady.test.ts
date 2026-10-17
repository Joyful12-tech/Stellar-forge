import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useIpfsReady, resetIpfsReadinessCache } from './useIpfsReady'

describe('useIpfsReady', () => {
  beforeEach(() => {
    resetIpfsReadinessCache()
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('starts in "checking" so a healthy deployment never flashes a misconfiguration warning', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockReturnValue(new Promise(() => {})), // never settles
    )

    const { result } = renderHook(() => useIpfsReady())

    expect(result.current).toBe('checking')
  })

  it('reports "ready" when the server holds credentials', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ configured: true }) }),
    )

    const { result } = renderHook(() => useIpfsReady())

    await waitFor(() => expect(result.current).toBe('ready'))
  })

  it('reports "unconfigured" when the server has no credentials', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ configured: false }) }),
    )

    const { result } = renderHook(() => useIpfsReady())

    await waitFor(() => expect(result.current).toBe('unconfigured'))
  })

  it('treats an unreachable probe as unconfigured rather than hanging', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))

    const { result } = renderHook(() => useIpfsReady())

    await waitFor(() => expect(result.current).toBe('unconfigured'))
  })

  it('queries the endpoint once no matter how many components mount', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ configured: true }) })
    vi.stubGlobal('fetch', fetchMock)

    const first = renderHook(() => useIpfsReady())
    const second = renderHook(() => useIpfsReady())

    await waitFor(() => expect(first.result.current).toBe('ready'))
    await waitFor(() => expect(second.result.current).toBe('ready'))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('/api/health/ipfs')
  })

  it('retries after a failure instead of caching the rejection forever', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ ok: true, json: async () => ({ configured: true }) })
    vi.stubGlobal('fetch', fetchMock)

    const failed = renderHook(() => useIpfsReady())
    await waitFor(() => expect(failed.result.current).toBe('unconfigured'))

    const retried = renderHook(() => useIpfsReady())
    await waitFor(() => expect(retried.result.current).toBe('ready'))
  })
})

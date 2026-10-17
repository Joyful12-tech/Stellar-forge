import { useEffect, useState } from 'react'

/**
 * Upload readiness, asked of the server rather than inferred from build-time
 * config.
 *
 * Pinata credentials live only in server env (`api/_lib/pinata.ts`). The
 * browser therefore cannot know whether pinning is possible by looking at its
 * own bundle — and the previous attempt to do so, reading `VITE_IPFS_API_KEY`
 * / `VITE_IPFS_API_SECRET`, is exactly what shipped those secrets to every
 * visitor (issue #921).
 *
 * `checking` is deliberately distinct from `unconfigured`: rendering the
 * "uploads are disabled" warning while the probe is still in flight would flash
 * a misconfiguration notice on every mount of a perfectly healthy deployment.
 */
export type IpfsReadiness = 'checking' | 'ready' | 'unconfigured'

const HEALTH_ENDPOINT = '/api/health/ipfs'

/**
 * Shared across every hook consumer so mounting three forms performs one
 * request. Cleared on failure so a transient network error doesn't pin the app
 * to "unconfigured" until reload.
 */
let inFlight: Promise<boolean> | null = null

async function probe(): Promise<boolean> {
  const res = await fetch(HEALTH_ENDPOINT)
  if (!res.ok) return false
  const body: unknown = await res.json()
  return (body as { configured?: unknown } | null)?.configured === true
}

function getReadiness(): Promise<boolean> {
  inFlight ??= probe().catch((err) => {
    inFlight = null
    throw err
  })
  return inFlight
}

/** Test seam: drop the memoized probe between cases. */
export function resetIpfsReadinessCache(): void {
  inFlight = null
}

export function useIpfsReady(): IpfsReadiness {
  const [readiness, setReadiness] = useState<IpfsReadiness>('checking')

  useEffect(() => {
    let active = true
    getReadiness()
      .then((configured) => {
        if (active) setReadiness(configured ? 'ready' : 'unconfigured')
      })
      .catch(() => {
        // Unreachable probe is treated the same as an unconfigured server:
        // uploads cannot be relied on, so don't invite the user to start one.
        if (active) setReadiness('unconfigured')
      })
    return () => {
      active = false
    }
  }, [])

  return readiness
}

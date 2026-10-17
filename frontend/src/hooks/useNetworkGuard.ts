import { useEffect, useRef, useState } from 'react'
import { useNetwork } from '../context/NetworkContext'
import type { Network } from '../context/NetworkContext'
import { networkLabel } from '../config/stellar'

/**
 * Returns whether write operations should be blocked due to a network mismatch.
 * Use this in any form that submits on-chain transactions.
 *
 * In addition to the original Freighter-vs-app mismatch check, this hook
 * also detects when the app's own target network changed (e.g. via a
 * cross-tab localStorage storage event — issue #1163) *after* the form was
 * mounted.  When that happens `networkChangedSinceMount` is `true` and the
 * form should block submission until the user explicitly re-confirms by
 * calling `acknowledgeNetworkChange()`.
 */
export interface NetworkGuard {
  blocked: boolean
  reason: string | null
  networkChangedSinceMount: boolean
  acknowledgeNetworkChange: () => void
}

export function useNetworkGuard(): NetworkGuard {
  const { mismatch, network } = useNetwork()

  // Capture the network value that was active when this hook instance first
  // rendered (i.e. when the form was opened).
  const mountedNetworkRef = useRef<Network>(network)
  const [networkChangedSinceMount, setNetworkChangedSinceMount] = useState(false)

  useEffect(() => {
    if (network !== mountedNetworkRef.current && !networkChangedSinceMount) {
      setNetworkChangedSinceMount(true)
    }
  }, [network, networkChangedSinceMount])

  const acknowledgeNetworkChange = () => {
    // The user has reviewed the new network context — update the baseline and
    // clear the change flag so the form can be submitted again.
    mountedNetworkRef.current = network
    setNetworkChangedSinceMount(false)
  }

  if (mismatch.isMismatch) {
    return {
      blocked: true,
      reason: `Switch Freighter to ${networkLabel(network)} to continue.`,
      networkChangedSinceMount,
      acknowledgeNetworkChange,
    }
  }

  if (networkChangedSinceMount) {
    return {
      blocked: true,
      reason: `Network changed to ${networkLabel(network)} since you opened this form. Review and confirm before continuing.`,
      networkChangedSinceMount,
      acknowledgeNetworkChange,
    }
  }

  return { blocked: false, reason: null, networkChangedSinceMount, acknowledgeNetworkChange }
}

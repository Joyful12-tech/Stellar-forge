import { useEffect, useRef, type RefObject } from 'react'

/**
 * A ref that is `true` while the component is mounted. Check it before
 * setting state or toasting after an `await`, so a transaction that settles
 * after the user navigated away doesn't update an unmounted component.
 */
export function useMountedRef(): RefObject<boolean> {
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])
  return mountedRef
}

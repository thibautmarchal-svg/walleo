import { useEffect } from 'react'

/**
 * Keeps the screen awake while the component is mounted.
 * Wake Lock API requires HTTPS and a user gesture on iOS.
 * Silently no-ops if the API is unavailable.
 */
export function useWakeLock(active = true): void {
  useEffect(() => {
    if (!active) return
    let sentinel: WakeLockSentinel | null = null
    let cancelled = false

    const acquire = async (): Promise<void> => {
      try {
        if (!('wakeLock' in navigator)) return
        sentinel = await navigator.wakeLock.request('screen')
      } catch {
        // permission denied or unsupported — silent no-op
      }
    }

    const onVisibility = (): void => {
      if (document.visibilityState === 'visible' && !sentinel && !cancelled) {
        void acquire()
      }
    }

    void acquire()
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibility)
      sentinel?.release().catch(() => {})
      sentinel = null
    }
  }, [active])
}

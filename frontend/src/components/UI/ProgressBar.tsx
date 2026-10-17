import React, { useEffect, useRef } from 'react'

interface ProgressBarProps {
  progress: number
  className?: string
}

/**
 * A progress bar whose fill width is driven via the CSSOM instead of an
 * inline `style` attribute.
 *
 * This keeps the bundle compatible with the strict Content-Security-Policy
 * (`style-src 'self'`, no `'unsafe-inline'`): CSSOM attribute updates are
 * permitted by CSP, while inline style attributes would be blocked.
 */
export const ProgressBar: React.FC<ProgressBarProps> = ({
  progress,
  className = 'bg-blue-600 h-2 rounded-full transition-all duration-300',
}) => {
  const fillRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (fillRef.current) {
      fillRef.current.style.width = `${Math.max(0, Math.min(progress, 100))}%`
    }
  }, [progress])

  return (
    <div
      ref={fillRef}
      className={className}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.max(0, Math.min(progress, 100))}
    />
  )
}

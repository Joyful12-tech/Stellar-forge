import React, { useState } from 'react'

interface ClampedTextProps {
  children: string
  /** Lines to show before clamping. */
  lines?: number
  /** Allow the reader to expand past the clamp. */
  expandable?: boolean
  className?: string
}

/**
 * ClampedText — renders untrusted free text inside a hard visual bound.
 *
 * This is defence in depth, not the primary control: `getMetadata` already
 * clamps `description` to MAX_METADATA_DESCRIPTION_LENGTH on the read path.
 * The CSS bound still matters because character count alone does not bound
 * *height* — a few hundred newlines, or combining marks that stack vertically,
 * occupy far more space than their length suggests. `line-clamp` bounds the
 * rendered box no matter what the characters do.
 *
 * Expanding is capped too: "show more" lifts the line clamp but keeps a
 * max-height with its own scroll region, so expanded text can never push the
 * rest of the page below the fold.
 */
export const ClampedText: React.FC<ClampedTextProps> = ({
  children,
  lines = 3,
  expandable = false,
  className = '',
}) => {
  const [expanded, setExpanded] = useState(false)

  // Tailwind needs literal class names to survive its scanner, so map rather
  // than interpolate `line-clamp-${lines}`.
  const clampClass =
    { 1: 'line-clamp-1', 2: 'line-clamp-2', 3: 'line-clamp-3', 4: 'line-clamp-4' }[lines] ??
    'line-clamp-3'

  return (
    <div>
      <p
        className={`${expanded ? 'max-h-64 overflow-y-auto' : clampClass} break-words whitespace-pre-wrap ${className}`}
      >
        {children}
      </p>
      {expandable && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-xs text-blue-600 dark:text-blue-400 underline hover:text-blue-800 dark:hover:text-blue-200 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded"
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  )
}

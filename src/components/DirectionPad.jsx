import { cn } from '../lib/utils.js'

// Nine pad slots, row by row. Slot 4 is the radial mode, the rest are linear
// gradient axes (x / y are the direction the ramp increases toward).
export const DIR_VECTORS = [
  { x: -1, y: 1 },
  { x: 0, y: 1 },
  { x: 1, y: 1 },
  { x: -1, y: 0 },
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: -1, y: -1 },
  { x: 0, y: -1 },
  { x: 1, y: -1 },
]

const CELLS = [
  {
    key: 'ul',
    title: 'ramp increases toward the top left',
    paths: (
      <>
        <path d="M17 17 7 7" />
        <path d="M7 17V7h10" />
      </>
    ),
  },
  {
    key: 'up',
    title: 'ramp increases upward',
    paths: (
      <>
        <path d="m5 12 7-7 7 7" />
        <path d="M12 19V5" />
      </>
    ),
  },
  {
    key: 'ur',
    title: 'ramp increases toward the top right',
    paths: (
      <>
        <path d="M7 7h10v10" />
        <path d="M7 17 17 7" />
      </>
    ),
  },
  {
    key: 'left',
    title: 'ramp increases leftward',
    paths: (
      <>
        <path d="m12 19-7-7 7-7" />
        <path d="M19 12H5" />
      </>
    ),
  },
  {
    key: 'radial',
    title: 'radial gradient from the center',
    paths: (
      <>
        <circle cx="12" cy="12" r="10" />
        <circle cx="12" cy="12" r="6" />
        <circle cx="12" cy="12" r="2" />
      </>
    ),
  },
  {
    key: 'right',
    title: 'ramp increases rightward',
    paths: (
      <>
        <path d="M5 12h14" />
        <path d="m12 5 7 7-7 7" />
      </>
    ),
  },
  {
    key: 'dl',
    title: 'ramp increases toward the bottom left',
    paths: (
      <>
        <path d="M17 7 7 17" />
        <path d="M17 17H7V7" />
      </>
    ),
  },
  {
    key: 'down',
    title: 'ramp increases downward',
    paths: (
      <>
        <path d="M12 5v14" />
        <path d="m19 12-7 7-7-7" />
      </>
    ),
  },
  {
    key: 'dr',
    title: 'ramp increases toward the bottom right',
    paths: (
      <>
        <path d="m7 7 10 10" />
        <path d="M17 7v10H7" />
      </>
    ),
  },
]

export default function DirectionPad({ value, onChange }) {
  return (
    <div className="grid w-[186px] grid-cols-3 gap-1.5" role="group" aria-label="Gradient direction">
      {CELLS.map((cell, i) => (
        <button
          key={cell.key}
          type="button"
          title={cell.title}
          aria-label={cell.title}
          aria-pressed={value === i}
          onClick={() => onChange(i)}
          className={cn(
            'flex h-12 items-center justify-center rounded-lg border transition-colors',
            value === i
              ? 'border-ring bg-secondary text-foreground'
              : 'border-border bg-secondary/25 text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
          )}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            {cell.paths}
          </svg>
        </button>
      ))}
    </div>
  )
}

import { useCallback, useEffect, useState } from 'react'
import { Button } from './ui/button.jsx'

// The guided walkthrough. Each step spotlights one control: sections get
// opened first, the target scrolls into view, then a card explains it.
// Anchors are looked up by id across the whole document, so panel controls
// and stage controls sit in the same tour.
const STEPS = [
  {
    anchor: '#tour-brand',
    scroll: false,
    title: 'welcome to parse',
    text: 'A colorama style recolor with a gradient reveal. This tour walks every control, one spotlight at a time. next and back move around, esc closes.',
  },
  {
    anchor: '#tour-open-photo',
    scroll: false,
    title: 'open photo',
    text: 'Load any photo at any size, or drop one straight onto the canvas. default photo brings the lighthouse back.',
  },
  {
    anchor: '#tour-stage',
    scroll: false,
    title: 'the stage',
    text: 'Everything renders live in WebGL. The colorized layer sits on top, and the untouched original waits underneath for the reveal.',
  },
  {
    anchor: '#sec-color',
    open: 'sec-color',
    title: 'color',
    text: 'Eighteen palette combos, hue shift, shuffle. photo tones re-inks the picture by its own light and shadow, the colorama trick from the linked video.',
  },
  {
    anchor: '#tour-combine',
    open: 'sec-color',
    title: 'combine with depth',
    text: 'Off, the photo tones decide the colors alone. On, the depth map shares the job, and the depth mix slider sets the blend between the two.',
  },
  {
    anchor: '#sec-direction',
    open: 'sec-direction',
    title: 'direction',
    text: 'The arrows push the ramp across the frame. The center dot turns it into a radial bloom from the middle.',
  },
  {
    anchor: '#sec-reveal',
    open: 'sec-reveal',
    title: 'reveal',
    text: 'play sweeps the colorized layer away so the original comes up underneath. wipe source decides whether the front follows the direction, the depth map, or a blend. softness and sweep blur shape the edge.',
  },
  {
    anchor: '#sec-motion',
    open: 'sec-motion',
    title: 'motion',
    text: 'animate cycles the palette forever. speed sets the pace, loop length sets how long the recorded loop runs.',
  },
  {
    anchor: '#sec-effects',
    open: 'sec-effects',
    title: 'effects',
    text: 'dither breaks the ramp into ordered dots right before the posterize step, for a print like grain.',
  },
  {
    anchor: '#sec-depth',
    open: 'sec-depth',
    title: 'depth',
    text: 'The depth map is a distance ruler the colors and the reveal can read. ai depth computes one for any photo on the server, so nothing downloads. save map exports it, and the switch turns depth off completely.',
  },
  {
    anchor: '#sec-output',
    open: 'sec-output',
    title: 'output',
    text: 'blend mixes the colorized layer over the photo. export png saves the frame, export video records the sweep, export loop records the animate cycle as a seamless clip.',
  },
  {
    anchor: '#tour-transport',
    scroll: false,
    title: 'transport',
    text: 'play runs the reveal end to end. hold to see the original peeks at the untouched photo for as long as you hold, and snaps back when you let go.',
  },
  {
    anchor: '#tour-reset',
    scroll: false,
    title: 'tour done',
    text: 'reset brings every control back to its defaults. poke at anything, nothing here breaks.',
  },
]

const CARD_W = 320
const CARD_H = 190

export default function Tour({ open, onClose }) {
  const [step, setStep] = useState(0)
  const [rect, setRect] = useState(null)
  const s = STEPS[step]

  const measure = useCallback((anchor) => {
    const el = anchor ? document.querySelector(anchor) : null
    if (!el) {
      setRect(null)
      return
    }
    setRect(el.getBoundingClientRect())
  }, [])

  // Fresh tour on every open.
  useEffect(() => {
    if (open) setStep(0)
  }, [open])

  // Per step: open the owning section if it is closed, scroll the target
  // into view, then measure it. Section opening animates for 0.18s, so the
  // wait covers that before scrolling.
  useEffect(() => {
    if (!open) return
    let alive = true
    const anchor = s.anchor
    const run = async () => {
      if (s.open) {
        const t = document.getElementById(s.open)
        if (t && t.getAttribute('data-state') === 'closed') {
          t.click()
          await new Promise((r) => setTimeout(r, 240))
        }
      }
      if (!alive) return
      const el = document.querySelector(anchor)
      if (el && s.scroll !== false) {
        el.scrollIntoView({ block: 'center' })
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      }
      if (alive) measure(anchor)
    }
    run()
    const again = () => measure(anchor)
    window.addEventListener('scroll', again, true)
    window.addEventListener('resize', again)
    return () => {
      alive = false
      window.removeEventListener('scroll', again, true)
      window.removeEventListener('resize', again)
    }
  }, [open, step, s, measure])

  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight') setStep((i) => Math.min(STEPS.length - 1, i + 1))
      else if (e.key === 'ArrowLeft') setStep((i) => Math.max(0, i - 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const vw = window.innerWidth
  const vh = window.innerHeight
  let card = null
  if (rect) {
    let left = rect.left + rect.width / 2 - CARD_W / 2
    left = Math.max(12, Math.min(vw - CARD_W - 12, left))
    let top = rect.bottom + 16
    if (top + CARD_H > vh - 12) top = Math.max(12, rect.top - CARD_H - 16)
    card = { left, top }
  }

  return (
    <div className="fixed inset-0 z-[90]">
      <div className="absolute inset-0" onClick={onClose} />
      {rect && (
        <div
          className="pointer-events-none absolute rounded-xl ring-2 ring-white/70 transition-[left,top,width,height] duration-150"
          style={{
            left: rect.left - 6,
            top: rect.top - 6,
            width: rect.width + 12,
            height: rect.height + 12,
            boxShadow: '0 0 0 200vmax rgba(6, 6, 8, 0.6)',
          }}
        />
      )}
      {card && (
        <div
          className="absolute rounded-xl border border-border bg-card p-4 shadow-2xl"
          style={{ left: card.left, top: card.top, width: CARD_W }}
        >
          <div className="mb-1 flex items-baseline justify-between gap-3">
            <span className="text-sm font-semibold">{s.title}</span>
            <span className="text-[11px] tabular-nums text-muted-foreground">
              {step + 1} / {STEPS.length}
            </span>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">{s.text}</p>
          <div className="mt-3 flex items-center justify-between gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>
              close
            </Button>
            <span className="flex gap-1.5">
              <Button variant="outline" size="sm" onClick={() => setStep((i) => Math.max(0, i - 1))} disabled={step === 0}>
                back
              </Button>
              {step === STEPS.length - 1 ? (
                <Button size="sm" onClick={onClose}>
                  done
                </Button>
              ) : (
                <Button size="sm" onClick={() => setStep((i) => Math.min(STEPS.length - 1, i + 1))}>
                  next
                </Button>
              )}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

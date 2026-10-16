import { useCallback, useEffect, useState } from 'react'
import { Button } from './ui/button.jsx'

// The guided walkthrough. Every control gets its own stop: the owning
// section opens if needed, the target scrolls into view and gets ringed
// while a card explains it. The card stays docked on the left and never
// moves, so the panel under the spotlight stays visible and next/back stay
// under the cursor. Anchors are ids looked up across the whole document, so
// stage controls and panel controls sit in the same tour.
const STEPS = [
  {
    anchor: '#tour-brand',
    scroll: false,
    title: 'the full tour',
    text: 'Every control in the app, one stop at a time, 42 in total. next and back move you along, esc or a click outside closes.',
  },
  {
    anchor: '#tour-open-photo',
    scroll: false,
    title: 'open photo',
    text: 'Load any photo at any size, or drop one straight onto the canvas. Once you load your own, a default photo button appears beside this one to bring the lighthouse back.',
  },
  {
    anchor: '#tour-github',
    scroll: false,
    title: 'the source',
    text: 'parse is open source. This button opens the repo on github: the shader, the depth function, the whole thing.',
  },
  {
    anchor: '#tour-reset',
    scroll: false,
    title: 'reset',
    text: 'Puts every control back to its defaults, the depth switch included.',
  },
  {
    anchor: '#tour-stage',
    scroll: false,
    title: 'the stage',
    text: 'The live render. The colorized layer sits on top and the untouched original waits underneath. Press and hold anywhere on the photo itself to peek at it.',
  },
  {
    anchor: '#tour-playmain',
    scroll: false,
    title: 'play',
    text: 'Runs the sweep end to end: the colorized layer travels across and the original comes up underneath.',
  },
  {
    anchor: '#tour-hold',
    scroll: false,
    title: 'hold to see the original',
    text: 'Peek at the untouched photo for as long as you hold the button. Release and the colorized layer snaps back.',
  },
  {
    anchor: '#tour-palettes',
    open: 'sec-color',
    title: 'the combos',
    text: 'Eighteen gradient strips. Every color in the render comes from a position on the strip of the selected combo.',
  },
  {
    anchor: '#tour-hueshift',
    open: 'sec-color',
    title: 'hue shift',
    text: 'Rotates every color in the palette around the wheel, in degrees.',
  },
  {
    anchor: '#tour-shuffle',
    open: 'sec-color',
    title: 'shuffle',
    text: 'Jumps to a random combo with a random hue, for happy accidents.',
  },
  {
    anchor: '#tour-tutorial',
    open: 'sec-color',
    title: 'the tutorial',
    text: 'The After Effects video this whole shader is modelled on. Opens in a new tab.',
  },
  {
    anchor: '#tour-phototones',
    open: 'sec-color',
    title: 'photo tones',
    text: "Reads the colors from the picture's own light and shadow, the way colorama does. On by default, and while it is on it takes over the ramp the depth map would otherwise drive.",
  },
  {
    anchor: '#tour-combine',
    open: 'sec-color',
    title: 'combine with depth',
    text: 'Blends the photo tones with the depth map instead of letting the tones win alone, and the depth mix slider then sets the share. The underlined link right below jumps straight to that slider.',
  },
  {
    anchor: '#tour-dirpad',
    open: 'sec-direction',
    title: 'direction',
    text: 'The arrows push the ramp across the frame; the center dot makes it a radial bloom from the middle. While animate runs, the pattern travels in whichever direction is picked.',
  },
  {
    anchor: '#tour-invert',
    open: 'sec-direction',
    title: 'invert',
    text: 'Flips the ramp, so both ends swap.',
  },
  {
    anchor: '#tour-revealslider',
    open: 'sec-reveal',
    title: 'reveal',
    text: 'Scrubs the wipe by hand. 0 is the full colorized layer, 1 is the original, everything between is the transition.',
  },
  {
    anchor: '#tour-playsec',
    open: 'sec-reveal',
    title: 'play, panel side',
    text: 'Same sweep as the big play, for when your hand is already on this side.',
  },
  {
    anchor: '#tour-wipesource',
    open: 'sec-reveal',
    title: 'wipe source',
    text: "At direction the front moves along the chosen arrow. Slide it toward depth map and the original comes in along the scene's contours instead.",
  },
  {
    anchor: '#tour-softness',
    open: 'sec-reveal',
    title: 'softness',
    text: 'How wide and soft the edge of the reveal front is.',
  },
  {
    anchor: '#tour-sweepblur',
    open: 'sec-reveal',
    title: 'sweep blur',
    text: 'Blurs the input while the sweep runs, peaking halfway through, like the animated box blur in the tutorial.',
  },
  {
    anchor: '#tour-rollcolors',
    open: 'sec-reveal',
    title: 'roll colors',
    text: 'The palette cycles through while the sweep runs, so colors flow through the frame as it reveals.',
  },
  {
    anchor: '#tour-animate',
    open: 'sec-motion',
    title: 'animate',
    text: 'Cycles the palette forever, and the colour pattern travels in the current direction. A living loop of the whole image.',
  },
  {
    anchor: '#tour-speed',
    open: 'sec-motion',
    title: 'speed',
    text: 'How fast animate cycles.',
  },
  {
    anchor: '#tour-looplength',
    open: 'sec-motion',
    title: 'loop length',
    text: 'Sets the length of the seamless loop export. It snaps to whole palette rounds so the clip repeats without a seam.',
  },
  {
    anchor: '#tour-cycles',
    open: 'sec-effects',
    title: 'cycles',
    text: 'How many palette rounds fit across the frame. Above 1 the strip repeats across the image.',
  },
  {
    anchor: '#tour-phase',
    open: 'sec-effects',
    title: 'phase',
    text: 'Shifts where in the palette the ramp starts, sliding all colors at once.',
  },
  {
    anchor: '#tour-steps',
    open: 'sec-effects',
    title: 'steps',
    text: 'Posterizes the ramp into flat bands. 1 is the smooth gradient, higher numbers go chunky print.',
  },
  {
    anchor: '#tour-loopramp',
    open: 'sec-effects',
    title: 'loop ramp',
    text: 'Wraps the ramp so it tiles around instead of clamping at the ends.',
  },
  {
    anchor: '#tour-dither',
    open: 'sec-effects',
    title: 'dither',
    text: 'Patterns the ramp into ordered dots right before the posterize step. Switching it on bumps steps to 8 automatically.',
  },
  {
    anchor: '#tour-ditheramount',
    open: 'sec-effects',
    title: 'dither amount',
    text: 'How strong the dot pattern is.',
  },
  {
    anchor: '#tour-dithersize',
    open: 'sec-effects',
    title: 'dither size',
    text: 'The dot size in pixels, 1 to 10. The cell size is locked to the photo, so a full size export matches the screen.',
  },
  {
    anchor: '#tour-ditherstyle',
    open: 'sec-effects',
    title: 'bayer or noise',
    text: 'An ordered lattice or random grain. Bayer is the classic print look, noise is softer.',
  },
  {
    anchor: '#tour-usedepth',
    open: 'sec-depth',
    title: 'use depth map',
    text: 'The on and off for everything depth related. Off means no depth pass and no server call at all.',
  },
  {
    anchor: '#depth-mix',
    open: 'sec-depth',
    title: 'depth mix',
    text: 'The blend knob: ramp position on one side, the depth map on the other. With combine on it becomes tones versus depth instead.',
  },
  {
    anchor: '#tour-viewdepth',
    open: 'sec-depth',
    title: 'view depth',
    text: 'Shows the depth map itself: bright is far, dark is near. A quick sanity check on any photo.',
  },
  {
    anchor: '#tour-aidepth',
    open: 'sec-depth',
    title: 'ai depth',
    text: 'Computes a fresh depth map for the current photo. It runs on a small serverless function that carries the model, so nothing is downloaded here.',
  },
  {
    anchor: '#tour-savemap',
    open: 'sec-depth',
    title: 'save map',
    text: 'Downloads the current depth map as a grayscale png.',
  },
  {
    anchor: '#tour-blend',
    open: 'sec-output',
    title: 'blend',
    text: 'How much of the colorized layer sits over the photo. At 100% the photo is fully replaced by the ramp.',
  },
  {
    anchor: '#tour-exportpng',
    open: 'sec-output',
    title: 'export png',
    text: 'Saves the current frame at the full buffer resolution.',
  },
  {
    anchor: '#tour-exportvideo',
    open: 'sec-output',
    title: 'export video',
    text: 'Records the sweep as an mp4 in quality mode: frames are rendered on a fixed clock and encoded at 40 mbps, with the realtime recorder as fallback.',
  },
  {
    anchor: '#tour-exportloop',
    open: 'sec-output',
    title: 'export loop',
    text: 'Records the animate cycle as a seamless looping clip, at the loop length set in motion.',
  },
  {
    anchor: '#tour-start',
    scroll: false,
    title: 'tour done',
    text: "That's the whole app. Replay this tour from this button anytime, and reset returns everything to defaults.",
  },
]

const CARD_W = 330
const CARD_H = 230

export default function Tour({ open, onClose }) {
  const [step, setStep] = useState(0)
  const [rect, setRect] = useState(null)
  const [inPanel, setInPanel] = useState(false)
  const s = STEPS[step]

  const measure = useCallback((anchor) => {
    const el = anchor ? document.querySelector(anchor) : null
    if (!el) {
      setRect(null)
      setInPanel(false)
      return
    }
    setRect(el.getBoundingClientRect())
    const panel = document.getElementById('tour-panel')
    setInPanel(!!(panel && panel.contains(el)))
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

  // Placement: targets inside the right control panel get the card parked on
  // the left of the panel, vertically aligned with the target, so the panel
  // stays fully visible. Anything on the stage or the top bar gets the card
  // right next to it, a moving tooltip that follows the spotlight.
  const vw = window.innerWidth
  const vh = window.innerHeight
  const panelEl = document.getElementById('tour-panel')
  const panelRect = panelEl ? panelEl.getBoundingClientRect() : null
  let cardLeft = panelRect ? Math.max(12, panelRect.left - CARD_W - 14) : 20
  let cardTop = Math.max(16, vh / 2 - CARD_H / 2)
  if (rect && !inPanel) {
    cardLeft = Math.max(12, Math.min(vw - CARD_W - 12, rect.left + rect.width / 2 - CARD_W / 2))
    cardTop = rect.bottom + 16
    if (cardTop + CARD_H > vh - 12) cardTop = Math.max(12, rect.top - CARD_H - 16)
  } else if (rect) {
    cardTop = Math.max(16, Math.min(vh - CARD_H - 16, rect.top + rect.height / 2 - CARD_H / 2))
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
      <div
        className="absolute rounded-xl border border-border bg-card p-4 shadow-2xl transition-[left,top] duration-150"
        style={{ left: cardLeft, top: cardTop, width: CARD_W }}
      >
        <div className="mb-1 flex items-baseline justify-between gap-3">
          <span className="text-sm font-semibold">{s.title}</span>
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {step + 1} / {STEPS.length}
          </span>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">{s.text}</p>
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-200"
            style={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
          />
        </div>
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
    </div>
  )
}

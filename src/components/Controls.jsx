import { useState } from 'react'
import { ChevronDown, Play, Shuffle, Square } from 'lucide-react'
import DirectionPad from './DirectionPad.jsx'
import { Button } from './ui/button.jsx'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible.jsx'
import { Slider } from './ui/slider.jsx'
import { Switch } from './ui/switch.jsx'
import { PALETTES, paletteCss } from '../lib/palettes.js'
import { cn } from '../lib/utils.js'

function Section({ title, children, defaultOpen = true, open: controlledOpen, onOpenChange }) {
  const [uncontrolled, setUncontrolled] = useState(defaultOpen)
  const controlled = controlledOpen !== undefined
  const open = controlled ? controlledOpen : uncontrolled
  const setOpen = controlled ? onOpenChange : setUncontrolled
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="flex flex-col">
      <CollapsibleTrigger className="group flex w-full items-center justify-between text-[11px] font-semibold uppercase tracking-[0.09em] text-muted-foreground transition-colors hover:text-foreground">
        <span>{title}</span>
        <ChevronDown className="size-3.5 transition-transform group-data-[state=closed]:-rotate-90" />
      </CollapsibleTrigger>
      <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
        <div className="flex flex-col gap-3 pt-3">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  )
}

function PSlider({ label, value, min, max, step, onChange, display, disabled, id }) {
  return (
    <div id={id} className={cn('flex flex-col gap-1.5', disabled && 'opacity-50')}>
      <div className="flex items-baseline justify-between">
        <span className="text-xs text-foreground/85">{label}</span>
        <span className="text-[11px] tabular-nums text-muted-foreground">{display ? display(value) : value}</span>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={(v) => onChange(v[0])}
        disabled={disabled}
      />
    </div>
  )
}

function Toggle({ label, checked, onChange, disabled }) {
  return (
    <label
      className={cn(
        'flex items-center justify-between gap-3',
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
      )}
    >
      <span className="text-xs text-foreground/85">{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </label>
  )
}

function Hint({ children }) {
  return <p className="text-[11px] leading-relaxed text-muted-foreground/80">{children}</p>
}

export default function Controls({
  value,
  onChange,
  onExport,
  onExportVideo,
  onExportLoop,
  recording,
  onSaveDepth,
  onAIDepth,
  aiBusy,
  onPlay,
  playing,
}) {
  const pct = (v) => `${Math.round(v * 100)}%`
  const {
    dirIndex, invert, depthMix, depthOn, photo, combineDepth, wipe, wipeSource, soft, sweepBlur, rollColors,
    repeat, wrap, offset, steps, blend, paletteId, hueShift, animate, speed, viewDepth,
    dither, ditherStrength, ditherSize, ditherStyle, loopSeconds,
  } = value

  // Opens the depth section and brings the depth mix row into view. The
  // section animates open in 0.18s, so the scroll waits for it to settle.
  const [depthOpen, setDepthOpen] = useState(false)
  const jumpToDepthMix = () => {
    setDepthOpen(true)
    setTimeout(() => {
      const el = document.getElementById('depth-mix')
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 260)
  }

  return (
    <aside className="panel-scroll flex w-[324px] flex-none flex-col gap-5 overflow-y-auto border-l border-border bg-card/25 p-4 max-[620px]:w-full max-[620px]:border-l-0 max-[620px]:border-t">
      <Section title="color">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(86px,1fr))] gap-1.5">
          {PALETTES.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => onChange({ paletteId: p.id })}
              className={cn(
                'flex flex-col gap-1 rounded-lg border p-1.5 text-left transition-colors',
                paletteId === p.id
                  ? 'border-ring bg-secondary/50'
                  : 'border-transparent hover:border-border hover:bg-secondary/20'
              )}
            >
              <span
                className="h-5 rounded-md border border-white/10"
                style={{ background: paletteCss(p, hueShift / 180) }}
              />
              <span
                className={cn(
                  'px-0.5 text-[11px] leading-none',
                  paletteId === p.id ? 'text-foreground' : 'text-muted-foreground'
                )}
              >
                {p.name}
              </span>
            </button>
          ))}
        </div>
        <PSlider
          label="hue shift"
          value={hueShift}
          min={-180}
          max={180}
          step={1}
          onChange={(v) => onChange({ hueShift: v })}
          display={(v) => `${Math.round(v)} deg`}
        />
        <Button
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() => {
            const pick = PALETTES[Math.floor(Math.random() * PALETTES.length)]
            onChange({ paletteId: pick.id, hueShift: Math.round((Math.random() * 2 - 1) * 60) })
          }}
        >
          <Shuffle />
          shuffle
        </Button>
        <Toggle label="photo tones" checked={photo} onChange={(v) => onChange({ photo: v })} />
        <Toggle
          label="combine with depth"
          checked={combineDepth}
          onChange={(v) => onChange({ combineDepth: v })}
          disabled={depthOn === false}
        />
        <Hint>
          photo tones reads the colors from the picture itself, the way colorama does in{' '}
          <a
            href="https://www.youtube.com/watch?v=JQ85g-OTy50"
            target="_blank"
            rel="noreferrer"
            className="text-foreground/90 underline underline-offset-2 transition-colors hover:text-foreground"
          >
            the tutorial
          </a>
          . otherwise the ramp comes from the direction or the depth map. combine with depth blends the two, and{' '}
          <button
            type="button"
            onClick={jumpToDepthMix}
            className="text-foreground/90 underline underline-offset-2 transition-colors hover:text-foreground"
          >
            the depth mix slider
          </button>{' '}
          then sets how much of the ramp comes from the map versus the photo's tones.
        </Hint>
      </Section>

      <Section title="direction">
        <DirectionPad value={dirIndex} onChange={(i) => onChange({ dirIndex: i })} />
        <Toggle label="invert" checked={invert} onChange={(v) => onChange({ invert: v })} />
      </Section>

      <Section title="reveal">
        <PSlider
          label="reveal"
          value={wipe}
          min={0}
          max={1}
          step={0.01}
          onChange={(v) => onChange({ wipe: v })}
          display={pct}
        />
        <Button variant="secondary" size="sm" className="self-start" onClick={onPlay}>
          {playing ? <Square /> : <Play />}
          {playing ? 'stop' : 'play'}
        </Button>
        <PSlider
          label="wipe source"
          value={wipeSource}
          min={0}
          max={1}
          step={0.01}
          onChange={(v) => onChange({ wipeSource: v })}
          disabled={depthOn === false}
          display={(v) =>
            depthOn === false ? 'direction' : v >= 0.999 ? 'depth map' : v <= 0.001 ? 'direction' : `${Math.round(v * 100)}%`
          }
        />
        <PSlider
          label="softness"
          value={soft}
          min={0.02}
          max={0.5}
          step={0.01}
          onChange={(v) => onChange({ soft: v })}
          display={pct}
        />
        <PSlider
          label="sweep blur"
          value={sweepBlur}
          min={0}
          max={1}
          step={0.01}
          onChange={(v) => onChange({ sweepBlur: v })}
          display={pct}
        />
        <Toggle
          label="roll colors while sweeping"
          checked={rollColors}
          onChange={(v) => onChange({ rollColors: v })}
        />
        <Hint>
          the front runs through the chosen direction by default, blooming out of the middle on the center dot, and the
          original comes up underneath. slide it toward the depth map for a wipe that follows the scene by depth
          instead.
        </Hint>
      </Section>

      <Section title="motion">
        <Toggle label="animate" checked={animate} onChange={(v) => onChange({ animate: v })} />
        <PSlider
          label="speed"
          value={speed}
          min={0}
          max={1}
          step={0.01}
          onChange={(v) => onChange({ speed: v })}
          display={(v) => v.toFixed(2)}
        />
        <PSlider
          label="loop length"
          value={loopSeconds}
          min={1}
          max={12}
          step={1}
          onChange={(v) => onChange({ loopSeconds: v })}
          display={(v) => {
            const speedNow = Math.max(0.02, speed)
            const cycles = Math.max(1, Math.round(v * speedNow))
            return `${(cycles / speedNow).toFixed(1)}s`
          }}
        />
        <Hint>
          export loop records the animate cycle for a whole number of rounds, so the clip repeats without a seam. this
          slider sets how long it runs.
        </Hint>
      </Section>

      <Section title="effects" defaultOpen={false}>
        <PSlider
          label="cycles"
          value={repeat}
          min={1}
          max={4}
          step={0.05}
          onChange={(v) => onChange({ repeat: v })}
          display={(v) => `${v.toFixed(2)}x`}
        />
        <PSlider
          label="phase"
          value={offset}
          min={-1}
          max={1}
          step={0.01}
          onChange={(v) => onChange({ offset: v })}
          display={(v) => v.toFixed(2)}
        />
        <PSlider
          label="steps"
          value={steps}
          min={1}
          max={24}
          step={1}
          onChange={(v) => onChange({ steps: v })}
          display={(v) => (v <= 1 ? 'smooth' : `${v}`)}
        />
        <Toggle label="loop ramp" checked={wrap} onChange={(v) => onChange({ wrap: v })} />
        <Toggle
          label="dither"
          checked={dither}
          onChange={(v) => onChange(v && steps <= 1 ? { dither: v, steps: 8 } : { dither: v })}
        />
        <PSlider
          label="dither amount"
          value={ditherStrength}
          min={0}
          max={1}
          step={0.02}
          onChange={(v) => onChange({ ditherStrength: v })}
          display={pct}
        />
        <PSlider
          label="dither size"
          value={ditherSize}
          min={1}
          max={10}
          step={1}
          onChange={(v) => onChange({ ditherSize: v })}
          display={(v) => `${Math.round(v)} px`}
        />
        <div className="flex gap-1.5">
          <Button
            variant={ditherStyle === 0 ? 'secondary' : 'outline'}
            size="sm"
            onClick={() => onChange({ ditherStyle: 0 })}
          >
            bayer
          </Button>
          <Button
            variant={ditherStyle === 1 ? 'secondary' : 'outline'}
            size="sm"
            onClick={() => onChange({ ditherStyle: 1 })}
          >
            noise
          </Button>
        </div>
        <Hint>
          dither patterns the ramp just before the posterize step, breaking stacked colors into ordered dots. it bumps
          steps to 8 when switched on; pull steps back down for a finer grain.
        </Hint>
      </Section>

      <Section title="depth" open={depthOpen} onOpenChange={setDepthOpen}>
        <Toggle
          label="use depth map"
          checked={depthOn !== false}
          onChange={(v) => onChange({ depthOn: v })}
        />
        <PSlider
          id="depth-mix"
          label="depth mix"
          value={depthMix}
          min={0}
          max={1}
          step={0.01}
          onChange={(v) => onChange({ depthMix: v })}
          display={pct}
          disabled={depthOn === false}
        />
        <Toggle
          label="view depth"
          checked={viewDepth}
          onChange={(v) => onChange({ viewDepth: v })}
          disabled={depthOn === false}
        />
        <div className="flex flex-wrap gap-1.5">
          <Button
            variant="outline"
            size="sm"
            onClick={onAIDepth}
            disabled={aiBusy || depthOn === false}
            title="runs depth anything v2 on the current photo"
          >
            {aiBusy ? 'ai depth...' : 'ai depth'}
          </Button>
          <Button variant="outline" size="sm" onClick={onSaveDepth} disabled={depthOn === false}>
            save map
          </Button>
        </div>
        <Hint>
          depth mix blends the ramp between the position along the direction and the depth map. switch the depth map off
          and the ramp and the reveal run on tone and position alone, with no depth pass and no server call.
        </Hint>
      </Section>

      <Section title="output">
        <PSlider
          label="blend"
          value={blend}
          min={0}
          max={1}
          step={0.01}
          onChange={(v) => onChange({ blend: v })}
          display={pct}
        />
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" onClick={onExport}>
            export png
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onExportVideo}
            disabled={recording}
            title="records the sweep as a video"
          >
            {recording ? 'recording...' : 'export video'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onExportLoop}
            disabled={recording}
            title="records the animate cycle as a seamless looping clip"
          >
            {recording ? 'recording...' : 'export loop'}
          </Button>
        </div>
      </Section>

      <p className="text-[11px] leading-relaxed text-muted-foreground/70">
        on the hosted site the depth runs on a small serverless function that carries the model, so nothing is
        downloaded to your machine. the local file build falls back to running depth anything v2 (small) in the
        browser itself, webgpu first. the bundled photo ships with a map generated offline (npm run depth). the
        shader only reads a grayscale texture, so any estimate drops in the same way.
      </p>
    </aside>
  )
}

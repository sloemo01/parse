import { useState } from 'react'
import DirectionPad from './DirectionPad.jsx'
import { PALETTES, paletteCss } from '../lib/palettes.js'

function PlayGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <polygon points="6 3 20 12 6 21 6 3" fill="currentColor" stroke="none" />
    </svg>
  )
}

function StopGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" stroke="none" />
    </svg>
  )
}

function Slider({ label, value, min, max, step, onChange, display }) {
  return (
    <label className="control">
      <span className="control-head">
        <span>{label}</span>
        <em>{display ? display(value) : value}</em>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
    </label>
  )
}

function Toggle({ label, checked, onChange }) {
  return (
    <button
      type="button"
      className={'toggle' + (checked ? ' on' : '')}
      aria-pressed={checked}
      onClick={() => onChange(!checked)}
    >
      <span className="knob" />
      <span>{label}</span>
    </button>
  )
}

function Section({ title, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className={'group' + (open ? '' : ' closed')}>
      <button type="button" className="group-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <h2>{title}</h2>
        <svg
          className="chev"
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && <div className="group-body">{children}</div>}
    </section>
  )
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
    dirIndex, invert, depthMix, photo, wipe, wipeSource, soft, sweepBlur, rollColors,
    repeat, wrap, offset, steps, blend, paletteId, hueShift, animate, speed, viewDepth,
    dither, ditherStrength, ditherSize, ditherStyle, loopSeconds,
  } = value

  return (
    <aside className="panel">
      <Section title="color">
        <div className="chips">
          {PALETTES.map((p) => (
            <button
              key={p.id}
              type="button"
              className={'chip' + (paletteId === p.id ? ' sel' : '')}
              onClick={() => onChange({ paletteId: p.id })}
            >
              <span className="chip-bar" style={{ background: paletteCss(p, hueShift / 180) }} />
              <span className="chip-name">{p.name}</span>
            </button>
          ))}
        </div>
        <Slider
          label="hue shift"
          value={hueShift}
          min={-180}
          max={180}
          step={1}
          onChange={(v) => onChange({ hueShift: v })}
          display={(v) => `${Math.round(v)} deg`}
        />
        <div className="inline">
          <button
            type="button"
            className="ghost"
            onClick={() => {
              const pick = PALETTES[Math.floor(Math.random() * PALETTES.length)]
              onChange({ paletteId: pick.id, hueShift: Math.round((Math.random() * 2 - 1) * 60) })
            }}
          >
            shuffle
          </button>
          <Toggle label="photo tones" checked={photo} onChange={(v) => onChange({ photo: v })} />
        </div>
        <p className="hint">
          photo tones reads the colors from the picture itself, the way colorama does in the tutorial. otherwise the
          ramp comes from the direction or the depth map.
        </p>
      </Section>

      <Section title="direction">
        <DirectionPad value={dirIndex} onChange={(i) => onChange({ dirIndex: i })} />
        <Toggle label="invert" checked={invert} onChange={(v) => onChange({ invert: v })} />
      </Section>

      <Section title="reveal">
        <Slider
          label="reveal"
          value={wipe}
          min={0}
          max={1}
          step={0.01}
          onChange={(v) => onChange({ wipe: v })}
          display={pct}
        />
        <div className="inline">
          <button type="button" className="ghost icon-btn" onClick={onPlay}>
            {playing ? <StopGlyph /> : <PlayGlyph />}
            <span>{playing ? 'stop' : 'play'}</span>
          </button>
        </div>
        <Slider
          label="wipe source"
          value={wipeSource}
          min={0}
          max={1}
          step={0.01}
          onChange={(v) => onChange({ wipeSource: v })}
          display={(v) => (v >= 0.999 ? 'depth map' : v <= 0.001 ? 'direction' : `${Math.round(v * 100)}%`)}
        />
        <Slider
          label="softness"
          value={soft}
          min={0.02}
          max={0.5}
          step={0.01}
          onChange={(v) => onChange({ soft: v })}
          display={pct}
        />
        <Slider
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
        <p className="hint">
          the front runs through the chosen direction by default, blooming out of the middle on the center dot, and
          the original comes up underneath. slide it toward the depth map for a wipe that follows the scene by depth
          instead.
        </p>
      </Section>

      <Section title="motion">
        <Toggle label="animate" checked={animate} onChange={(v) => onChange({ animate: v })} />
        <Slider
          label="speed"
          value={speed}
          min={0}
          max={1}
          step={0.01}
          onChange={(v) => onChange({ speed: v })}
          display={(v) => v.toFixed(2)}
        />
        <Slider
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
        <p className="hint">
          export loop records the animate cycle for a whole number of rounds, so the clip repeats without a seam. this
          slider sets how long it runs.
        </p>
      </Section>

      <Section title="effects" defaultOpen={false}>
        <Slider
          label="cycles"
          value={repeat}
          min={1}
          max={4}
          step={0.05}
          onChange={(v) => onChange({ repeat: v })}
          display={(v) => `${v.toFixed(2)}x`}
        />
        <Slider
          label="phase"
          value={offset}
          min={-1}
          max={1}
          step={0.01}
          onChange={(v) => onChange({ offset: v })}
          display={(v) => v.toFixed(2)}
        />
        <Slider
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
        <Slider
          label="dither amount"
          value={ditherStrength}
          min={0}
          max={1}
          step={0.02}
          onChange={(v) => onChange({ ditherStrength: v })}
          display={pct}
        />
        <Slider
          label="dither size"
          value={ditherSize}
          min={1}
          max={10}
          step={1}
          onChange={(v) => onChange({ ditherSize: v })}
          display={(v) => `${Math.round(v)} px`}
        />
        <div className="inline">
          <button
            type="button"
            className={'seg' + (ditherStyle === 0 ? ' on' : '')}
            onClick={() => onChange({ ditherStyle: 0 })}
          >
            bayer
          </button>
          <button
            type="button"
            className={'seg' + (ditherStyle === 1 ? ' on' : '')}
            onClick={() => onChange({ ditherStyle: 1 })}
          >
            noise
          </button>
        </div>
        <p className="hint">
          dither patterns the ramp just before the posterize step, breaking stacked colors into ordered dots. it bumps
          steps to 8 when switched on; pull steps back down for a finer grain.
        </p>
      </Section>

      <Section title="depth" defaultOpen={false}>
        <Slider
          label="depth mix"
          value={depthMix}
          min={0}
          max={1}
          step={0.01}
          onChange={(v) => onChange({ depthMix: v })}
          display={pct}
        />
        <div className="inline">
          <Toggle label="view depth" checked={viewDepth} onChange={(v) => onChange({ viewDepth: v })} />
          <button
            type="button"
            className="ghost"
            onClick={onAIDepth}
            disabled={aiBusy}
            title="runs depth anything v2 on the current photo"
          >
            {aiBusy ? 'ai depth...' : 'ai depth'}
          </button>
          <button type="button" className="ghost" onClick={onSaveDepth}>
            save map
          </button>
        </div>
        <p className="hint">depth mix blends the ramp between the position along the direction and the depth map.</p>
      </Section>

      <Section title="output">
        <Slider
          label="blend"
          value={blend}
          min={0}
          max={1}
          step={0.01}
          onChange={(v) => onChange({ blend: v })}
          display={pct}
        />
        <div className="inline">
          <button type="button" className="primary" onClick={onExport}>
            export png
          </button>
          <button
            type="button"
            className="ghost"
            onClick={onExportVideo}
            disabled={recording}
            title="records the sweep as a video"
          >
            {recording ? 'recording...' : 'export video'}
          </button>
          <button
            type="button"
            className="ghost"
            onClick={onExportLoop}
            disabled={recording}
            title="records the animate cycle as a seamless looping clip"
          >
            {recording ? 'recording...' : 'export loop'}
          </button>
        </div>
      </Section>

      <p className="note">
        on the hosted site the depth runs on a small serverless function that carries the model, so nothing is
        downloaded to your machine. the local file build falls back to running depth anything v2 (small) in the
        browser itself, webgpu first. the bundled photo ships with a map generated offline (npm run depth). the
        shader only reads a grayscale texture, so any estimate drops in the same way.
      </p>
    </aside>
  )
}

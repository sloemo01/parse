import { useEffect, useMemo, useRef, useState } from 'react'
import imageSrc from './assets/pexels-kaplanart-10776642.jpg'
import depthSrc from './assets/depth.png'
import depthSoftSrc from './assets/depth-soft.png'
import { createRenderer } from './gl/renderer.js'
import { PALETTES, buildLut } from './lib/palettes.js'
import { buildDepthPair, buildDepthSoft } from './lib/depth.js'
import { runAIDepth } from './lib/depthAI.js'
import { encodeWebCodecs } from './lib/videoExport.js'
import { Play, Square, Eye, Compass, Github } from 'lucide-react'
import Controls from './components/Controls.jsx'
import Tour from './components/Tour.jsx'
import { Button, buttonVariants } from './components/ui/button.jsx'
import { cn } from './lib/utils.js'
import { DIR_VECTORS } from './components/DirectionPad.jsx'

const DEFAULTS = {
  dirIndex: 4,
  invert: false,
  depthMix: 0.75,
  depthOn: true,
  combineDepth: false,
  photo: true,
  wipe: 0,
  wipeSource: 0,
  soft: 0.2,
  sweepBlur: 0,
  rollColors: true,
  repeat: 1,
  wrap: false,
  offset: 0,
  steps: 1,
  blend: 1,
  paletteId: PALETTES[0].id,
  hueShift: 0,
  animate: false,
  speed: 0.15,
  viewDepth: false,
  dither: false,
  ditherStrength: 0.6,
  ditherSize: 3,
  ditherStyle: 0,
  loopSeconds: 3,
}

// State can be deep linked with query params on the built file, for example
// ?wipe=0.5&wipesource=0&palette=neon
function initialParams() {
  const out = { ...DEFAULTS }
  if (typeof window === 'undefined') return out
  const q = new URLSearchParams(window.location.search)
  const num = (key, lo, hi, set) => {
    const v = parseFloat(q.get(key))
    if (!Number.isNaN(v)) set(Math.min(hi, Math.max(lo, v)))
  }
  num('wipe', 0, 1, (v) => (out.wipe = v))
  num('wipesource', 0, 1, (v) => (out.wipeSource = v))
  num('soft', 0.02, 0.5, (v) => (out.soft = v))
  num('blur', 0, 1, (v) => (out.sweepBlur = v))
  num('depth', 0, 1, (v) => (out.depthMix = v))
  if (q.get('depthmap') === '0') out.depthOn = false
  if (q.get('combine') === '1') out.combineDepth = true
  num('blend', 0, 1, (v) => (out.blend = v))
  num('dir', 0, 8, (v) => (out.dirIndex = Math.round(v)))
  const pal = q.get('palette')
  if (pal && PALETTES.some((p) => p.id === pal)) out.paletteId = pal
  if (q.get('photo') === '1') out.photo = true
  if (q.get('animate') === '1') out.animate = true
  if (q.get('viewdepth') === '1') out.viewDepth = true
  if (q.get('dither') === '1') out.dither = true
  num('ditherstrength', 0, 1, (v) => (out.ditherStrength = v))
  num('dithersize', 1, 10, (v) => (out.ditherSize = Math.round(v)))
  num('ditherstyle', 0, 1, (v) => (out.ditherStyle = Math.round(v)))
  num('loop', 1, 12, (v) => (out.loopSeconds = Math.round(v)))
  return out
}

function uniformState(s, time, original) {
  const v = DIR_VECTORS[s.dirIndex]
  return {
    dirX: v.x,
    dirY: v.y,
    radial: s.dirIndex === 4 ? 1 : 0,
    invert: s.invert ? 1 : 0,
    depthMix: s.depthOn === false ? 0 : s.depthMix,
    combine: s.depthOn === false ? 0 : s.combineDepth ? 1 : 0,
    photo: s.photo ? 1 : 0,
    wipe: s.wipe,
    wipeDepth: s.depthOn === false ? 0 : s.wipeSource,
    soft: s.soft,
    sweepBlur: s.sweepBlur,
    dither: s.dither ? s.ditherStrength : 0,
    ditherSize: s.ditherSize,
    ditherStyle: s.ditherStyle,
    repeat: s.repeat,
    wrap: s.wrap ? 1 : 0,
    offset: s.offset,
    roll: time % 1,
    steps: s.steps,
    blend: s.blend,
    viewDepth: s.depthOn === false ? 0 : s.viewDepth ? 1 : 0,
    original: original ? 1 : 0,
  }
}

export default function App() {
  const [params, setParams] = useState(initialParams)
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState('')
  const [revealing, setRevealing] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [imageVersion, setImageVersion] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [notice, setNotice] = useState('')
  const [customPhoto, setCustomPhoto] = useState(false)
  const [recording, setRecording] = useState(false)
  const [aiBusy, setAiBusy] = useState('')
  const [tourOpen, setTourOpen] = useState(false)

  const stageRef = useRef(null)
  const canvasRef = useRef(null)
  const rendererRef = useRef(null)
  const imageRef = useRef(null)
  const depthRef = useRef(null)
  const paramsRef = useRef(params)
  const timeRef = useRef(0)
  const revealRef = useRef(false)
  const dirtyRef = useRef(true)
  const sizeRef = useRef({ w: 0, h: 0 })
  const playRef = useRef({ active: false, from: 0, to: 0, start: 0, dur: 1, prevP: 0 })
  const bundledRef = useRef(null)
  const fileInputRef = useRef(null)
  const recordRef = useRef({ active: false })
  const aiTokenRef = useRef(0)

  const patch = (partial) => {
    if ('wipe' in partial && playRef.current.active) {
      playRef.current.active = false
      setPlaying(false)
    }
    setParams((p) => ({ ...p, ...partial }))
  }

  const startPlayback = () => {
    if (recordRef.current.active) return
    const pb = playRef.current
    if (pb.active) {
      pb.active = false
      setPlaying(false)
      return
    }
    const from = paramsRef.current.wipe
    const to = from > 0.999 ? 0 : 1
    playRef.current = {
      active: true,
      from,
      to,
      start: performance.now(),
      dur: 0.6 + 1.6 * Math.abs(to - from),
      prevP: 0,
    }
    setPlaying(true)
  }

  const setReveal = (v) => {
    if (revealRef.current === v) return
    revealRef.current = v
    dirtyRef.current = true
    setRevealing(v)
  }

  // Swap the photo the shader works on. The renderer keeps the old textures
  // until the new ones land, so this is a single render away.
  const showPhoto = (source, depth, soft, custom) => {
    const renderer = rendererRef.current
    if (!renderer) return
    imageRef.current = source
    depthRef.current = depth
    renderer.setImage(source)
    renderer.setDepth(depth)
    renderer.setDepthSoft(soft)
    dirtyRef.current = true
    setCustomPhoto(custom)
    setImageVersion((n) => n + 1)
  }

  // Any photo, any size: GPU textures have a hard ceiling, so oversized
  // photos are scaled down to fit it before uploading.
  const fitTextureSource = (img) => {
    const renderer = rendererRef.current
    const cap = Math.min(renderer ? renderer.maxTextureSize : 8192, 8192)
    const w = img.naturalWidth || img.width
    const h = img.naturalHeight || img.height
    if (w <= cap && h <= cap) return img
    const scale = cap / Math.max(w, h)
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(w * scale))
    canvas.height = Math.max(1, Math.round(h * scale))
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
    return canvas
  }

  // Depth anything v2, running in the browser through transformers.js.
  // Download and inference progress both land in aiBusy.
  const aiStatus = (p) => {
    if (!p) return
    if (p.stage === 'run') {
      setAiBusy('running depth anything v2 ...')
    } else if (p.status === 'progress' && typeof p.progress === 'number') {
      setAiBusy(`loading depth model ${Math.round(p.progress)}%`)
    } else if (p.status === 'ready') {
      setAiBusy('running depth anything v2 ...')
    }
  }

  const runAIDepthFor = async (source) => {
    const renderer = rendererRef.current
    if (!renderer || !source) return
    if (params.depthOn === false) return
    const token = ++aiTokenRef.current
    setAiBusy('loading depth model')
    try {
      const depth = await runAIDepth(source, aiStatus)
      if (aiTokenRef.current !== token) return
      depthRef.current = depth
      renderer.setDepth(depth)
      renderer.setDepthSoft(buildDepthSoft(depth))
      dirtyRef.current = true
      setAiBusy('')
    } catch (err) {
      if (aiTokenRef.current !== token) return
      setAiBusy('')
      setNotice('the depth model did not load, keeping the quick estimate')
    }
  }

  // Uploaded photos get a quick estimate right away, then the real model
  // refines it in the background.
  const loadFromFile = (file) => {
    if (!file) return
    if (file.type && !file.type.startsWith('image/')) {
      setNotice('that file is not an image')
      return
    }
    setNotice('')
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      try {
        const source = fitTextureSource(img)
        const pair = buildDepthPair(source)
        showPhoto(source, pair.depth, pair.soft, true)
        setNotice('')
        if (params.depthOn !== false) runAIDepthFor(source)
      } catch (err) {
        setNotice(err && err.message ? err.message : 'could not read that photo')
      } finally {
        URL.revokeObjectURL(url)
      }
    }
    img.onerror = () => {
      setNotice('could not decode that photo')
      URL.revokeObjectURL(url)
    }
    img.src = url
  }

  const onDragOver = (e) => {
    if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) {
      e.preventDefault()
      setDragging(true)
    }
  }

  const onDragLeave = (e) => {
    if (e.currentTarget.contains(e.relatedTarget)) return
    setDragging(false)
  }

  const onDrop = (e) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]
    if (file) loadFromFile(file)
  }

  // End the reveal when the pointer is released anywhere, or the window
  // loses focus mid-hold.
  useEffect(() => {
    if (!revealing) return
    const end = () => setReveal(false)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    window.addEventListener('blur', end)
    return () => {
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      window.removeEventListener('blur', end)
    }
  }, [revealing])

  // Load the photo and the depth map, spin up the renderer. The depth map is
  // generated offline (npm run depth); if it is missing the app falls back to
  // a quick luminance approximation.
  useEffect(() => {
    let alive = true
    const img = new Image()
    const depthImg = new Image()
    const depthSoftImg = new Image()
    const state = { photo: false, depth: false, depthSoft: false, depthFailed: false, failed: false }

    const finish = () => {
      if (!alive || state.failed) return
      if (!state.photo) return
      if (!state.depth && !state.depthFailed) return
      if (!state.depthSoft && !state.depthFailed) return
      try {
        const renderer = createRenderer(canvasRef.current)
        renderer.setLut(buildLut(PALETTES[0], 256, 0))
        rendererRef.current = renderer
        let depth = state.depth ? depthImg : null
        let depthSoft = state.depthSoft ? depthSoftImg : null
        if (!depth || !depthSoft) {
          const pair = buildDepthPair(img)
          depth = depth || pair.depth
          depthSoft = depthSoft || pair.soft
        }
        bundledRef.current = { img, depth, soft: depthSoft }
        showPhoto(img, depth, depthSoft, false)
        setStatus('ready')
      } catch (err) {
        state.failed = true
        setError(err && err.message ? err.message : String(err))
        setStatus('error')
      }
    }

    img.onload = () => {
      state.photo = true
      finish()
    }
    img.onerror = () => {
      state.failed = true
      setError('could not load the photo')
      setStatus('error')
    }
    depthImg.onload = () => {
      state.depth = true
      finish()
    }
    depthImg.onerror = () => {
      state.depthFailed = true
      finish()
    }
    depthSoftImg.onload = () => {
      state.depthSoft = true
      finish()
    }
    depthSoftImg.onerror = () => {
      state.depthFailed = true
      finish()
    }
    img.src = imageSrc
    depthImg.src = depthSrc
    depthSoftImg.src = depthSoftSrc
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    paramsRef.current = params
    dirtyRef.current = true
  }, [params])

  const palette = useMemo(
    () => PALETTES.find((p) => p.id === params.paletteId) || PALETTES[0],
    [params.paletteId]
  )

  useEffect(() => {
    if (!rendererRef.current) return
    rendererRef.current.setLut(buildLut(palette, 256, params.hueShift / 180))
    dirtyRef.current = true
  }, [palette, params.hueShift, status])

  // Render loop. Repaints when something is dirty, keeps painting while the
  // ramp animates or the reveal sweep plays.
  useEffect(() => {
    if (status !== 'ready') return
    let raf = 0
    let last = performance.now()
    const frame = (now) => {
      raf = requestAnimationFrame(frame)
      if (recordRef.current.active) return
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const s = paramsRef.current
      if (s.animate) {
        timeRef.current += dt * s.speed
        dirtyRef.current = true
      }
      const pb = playRef.current
      if (pb.active) {
        const p = Math.min(1, (now - pb.start) / (pb.dur * 1000))
        // Roll the palette while the sweep runs, at a constant rate so the
        // colour flow matches the animate toggle exactly.
        if (s.rollColors) timeRef.current += dt * (2.0 / pb.dur)
        const eased = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2
        paramsRef.current = { ...paramsRef.current, wipe: pb.from + (pb.to - pb.from) * eased }
        if (p >= 1) {
          pb.active = false
          setPlaying(false)
          setParams((prev) => ({ ...prev, wipe: pb.to }))
        }
        dirtyRef.current = true
      }
      if (!dirtyRef.current) return
      const { w, h } = sizeRef.current
      if (w < 2 || h < 2 || !rendererRef.current) return
      dirtyRef.current = false
      rendererRef.current.render(uniformState(s, timeRef.current, revealRef.current), w, h)
    }
    raf = requestAnimationFrame(frame)
    const repaint = () => {
      last = performance.now()
      dirtyRef.current = true
    }
    document.addEventListener('visibilitychange', repaint)
    window.addEventListener('focus', repaint)
    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('visibilitychange', repaint)
      window.removeEventListener('focus', repaint)
    }
  }, [status])

  // Fit the canvas to the stage, photo aspect kept, DPR capped at 2.
  useEffect(() => {
    if (status !== 'ready') return
    const stage = stageRef.current
    const canvas = canvasRef.current
    const img = imageRef.current
    const fit = () => {
      if (recordRef.current.active) return
      const rect = stage.getBoundingClientRect()
      const availW = Math.max(64, rect.width - 28)
      const availH = Math.max(64, rect.height - 28)
      const sw = img.naturalWidth || img.width
      const sh = img.naturalHeight || img.height
      const scale = Math.min(availW / sw, availH / sh)
      const cssW = Math.max(64, Math.floor(sw * scale))
      const cssH = Math.max(64, Math.floor(sh * scale))
      canvas.style.width = `${cssW}px`
      canvas.style.height = `${cssH}px`
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      sizeRef.current = { w: Math.round(cssW * dpr), h: Math.round(cssH * dpr) }
      dirtyRef.current = true
    }
    fit()
    // Paint once synchronously so the canvas never shows an empty frame,
    // even if rAF is throttled while the window sits in the background.
    if (!recordRef.current.active) {
      const { w, h } = sizeRef.current
      if (w >= 2 && h >= 2 && rendererRef.current) {
        dirtyRef.current = false
        rendererRef.current.render(
          uniformState(paramsRef.current, timeRef.current, revealRef.current),
          w,
          h
        )
      }
    }
    const ro = new ResizeObserver(fit)
    ro.observe(stage)
    return () => ro.disconnect()
  }, [status, imageVersion])

  const exportPng = () => {
    const renderer = rendererRef.current
    const img = imageRef.current
    if (!renderer || !img || recordRef.current.active) return
    const restore = renderer.beginExport(
      uniformState(paramsRef.current, timeRef.current, revealRef.current),
      img.naturalWidth || img.width,
      img.naturalHeight || img.height
    )
    canvasRef.current.toBlob((blob) => {
      restore()
      dirtyRef.current = true
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'parse-export.png'
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 4000)
    }, 'image/png')
  }

  const downloadBlob = (blob, name) => {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 8000)
  }

  // Shared recorder: runs drawFrame(t seconds, { renderer, w, h }) for
  // `duration` while MediaRecorder captures the canvas, then saves the clip.
  // Prefer the platform encoder (h264 in mp4) which stays real time on every
  // machine; webm is the fallback where mp4 recording is missing.
  const recordVideo = async ({ duration, filename, drawFrame }) => {
    const renderer = rendererRef.current
    const img = imageRef.current
    const canvas = canvasRef.current
    if (!renderer || !img || recordRef.current.active) return
    if (!canvas.captureStream || typeof MediaRecorder === 'undefined') {
      setNotice('this browser cannot record video')
      return
    }

    playRef.current.active = false
    setPlaying(false)

    const srcW = img.naturalWidth || img.width
    const srcH = img.naturalHeight || img.height
    const cap = 1920
    const scale = Math.min(1, cap / Math.max(srcW, srcH))
    const w = Math.max(2, 2 * Math.round((srcW * scale) / 2))
    const h = Math.max(2, 2 * Math.round((srcH * scale) / 2))

    recordRef.current.active = true
    setRecording(true)

    const mime =
      [
        'video/mp4;codecs=avc1.42E01E',
        'video/mp4',
        'video/webm;codecs=vp9',
        'video/webm;codecs=vp8',
        'video/webm',
      ].find((m) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) || ''
    const ext = mime.startsWith('video/mp4') ? 'mp4' : 'webm'

    let recorder
    try {
      recorder = new MediaRecorder(
        canvas.captureStream(60),
        mime ? { mimeType: mime, videoBitsPerSecond: 12000000 } : { videoBitsPerSecond: 12000000 }
      )
    } catch (err) {
      recordRef.current.active = false
      setRecording(false)
      setNotice('could not start the recorder')
      return
    }

    const chunks = []
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data)
    }
    const stopped = new Promise((resolve) => {
      recorder.onstop = resolve
      recorder.onerror = resolve
    })
    // Wall clock failsafe: if rAF gets throttled while the tab is hidden the
    // frame loop can stall, so a timer ends the recording no matter what.
    const failsafe = setTimeout(() => {
      if (recorder.state === 'recording') recorder.stop()
    }, duration * 1000 + 1500)

    // First frame before the recorder starts so the clip opens clean.
    drawFrame(0, { renderer, w, h })
    recorder.start(250)
    const t0 = performance.now()
    let raf = 0
    const frame = (now) => {
      const t = (now - t0) / 1000
      drawFrame(Math.min(t, duration), { renderer, w, h })
      if (t < duration) raf = requestAnimationFrame(frame)
      else recorder.stop()
    }
    raf = requestAnimationFrame(frame)

    await stopped
    clearTimeout(failsafe)
    cancelAnimationFrame(raf)
    if (recorder.stream) recorder.stream.getTracks().forEach((tr) => tr.stop())

    recordRef.current.active = false
    setRecording(false)
    dirtyRef.current = true

    if (chunks.length) {
      downloadBlob(new Blob(chunks, { type: mime || 'video/webm' }), `${filename}.${ext}`)
    } else {
      setNotice('the recorder came back empty')
    }
  }

  // Shared clip export: tries the offline WebCodecs path first (quality mode,
  // 40 Mbps, near native resolution, fixed frame clock), and falls back to the
  // realtime MediaRecorder when WebCodecs is missing.
  const exportClip = async ({ duration, filename, drawFrame }) => {
    const renderer = rendererRef.current
    const img = imageRef.current
    const canvas = canvasRef.current
    if (!renderer || !img || recordRef.current.active) return
    playRef.current.active = false
    setPlaying(false)

    const srcW = img.naturalWidth || img.width
    const srcH = img.naturalHeight || img.height
    const sizeFor = (cap) => {
      const scale = Math.min(1, cap / Math.max(srcW, srcH))
      return [
        Math.max(2, 2 * Math.round((srcW * scale) / 2)),
        Math.max(2, 2 * Math.round((srcH * scale) / 2)),
      ]
    }

    const [qw, qh] = sizeFor(2560)
    const fps = 60
    recordRef.current.active = true
    setRecording(true)
    let blob = null
    try {
      blob = await encodeWebCodecs({
        canvas,
        width: qw,
        height: qh,
        fps,
        frameCount: Math.max(1, Math.round(duration * fps)),
        drawFrame: (t) => drawFrame(t, { renderer, w: qw, h: qh }),
      })
    } catch (err) {
      blob = null
    }
    recordRef.current.active = false
    setRecording(false)
    dirtyRef.current = true

    if (blob) {
      downloadBlob(blob, `${filename}.mp4`)
      return
    }
    await recordVideo({ duration, filename, drawFrame })
  }

  // The sweep the play button runs, recorded end to end.
  const exportVideo = () =>
    exportClip({
      duration: 0.6 + 1.6 + 0.6,
      filename: 'parse-video',
      drawFrame: (t, { renderer, w, h }) => {
        const s = paramsRef.current
        const sweep = 0.6 + 1.6
        const p = Math.min(1, t / sweep)
        const eased = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2
        const roll = timeRef.current + (s.rollColors ? 2.0 * p : 0)
        renderer.render(uniformState({ ...s, wipe: eased }, roll, false), w, h)
      },
    })

  // The animate cycle, recorded for exactly a whole number of palette cycles
  // so the clip loops without a seam. The slider sets the rough length.
  const exportLoop = () => {
    const s = paramsRef.current
    const speed = Math.max(0.02, s.speed)
    const cycles = Math.max(1, Math.round((s.loopSeconds || 3) * speed))
    const duration = cycles / speed
    return exportClip({
      duration,
      filename: 'parse-loop',
      drawFrame: (t, { renderer, w, h }) => {
        renderer.render(uniformState(s, timeRef.current + t * speed, false), w, h)
      },
    })
  }

  const saveDepth = () => {
    const src = depthRef.current
    if (!src) return
    const c = document.createElement('canvas')
    c.width = src.naturalWidth || src.width
    c.height = src.naturalHeight || src.height
    c.getContext('2d').drawImage(src, 0, 0)
    const a = document.createElement('a')
    a.href = c.toDataURL('image/png')
    a.download = 'parse-depth-map.png'
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  const reset = () => {
    timeRef.current = 0
    playRef.current.active = false
    setPlaying(false)
    setParams(DEFAULTS)
  }

  return (
    <div
      className="flex h-screen min-h-[620px] flex-col bg-background text-foreground max-[620px]:h-auto max-[620px]:min-h-0"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <header className="flex items-center gap-3 border-b border-border px-4 py-2.5">
        <h1 id="tour-brand" className="text-sm font-semibold tracking-tight">parse</h1>
        <span className="text-xs text-muted-foreground">depth gradient colorama</span>
        {notice ? <span className="text-xs text-destructive">{notice}</span> : null}
        {aiBusy ? <span className="text-xs text-muted-foreground">{aiBusy}</span> : null}
        <span className="flex-1" />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files && e.target.files[0]
            if (f) loadFromFile(f)
            e.target.value = ''
          }}
        />
        <Button
          id="tour-open-photo"
          variant="outline"
          size="sm"
          onClick={() => fileInputRef.current && fileInputRef.current.click()}
        >
          open photo
        </Button>
        <a
          id="tour-github"
          href="https://github.com/sloemo01/parse"
          target="_blank"
          rel="noreferrer"
          title="parse on github, the full source"
          className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
        >
          <Github />
          github
        </a>
        {customPhoto ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const bundled = bundledRef.current
              if (bundled) showPhoto(bundled.img, bundled.depth, bundled.soft, false)
            }}
          >
            default photo
          </Button>
        ) : null}
        <Button
          id="tour-start"
          variant="outline"
          size="sm"
          onClick={() => setTourOpen(true)}
          title="a walkthrough of every control"
        >
          <Compass />
          tour
        </Button>
        <Button id="tour-reset" variant="ghost" size="sm" onClick={reset}>
          reset
        </Button>
      </header>
      <main className="flex min-h-0 flex-1 max-[620px]:flex-col">
        <section className="flex min-w-0 flex-1 flex-col max-[620px]:flex-none">
          <div
            className="relative flex min-h-0 flex-1 items-center justify-center p-4 max-[620px]:h-[430px] max-[620px]:flex-none"
            ref={stageRef}
          >
            <canvas
              id="tour-stage"
              ref={canvasRef}
              className="block rounded-xl bg-black shadow-2xl"
              onPointerDown={() => setReveal(true)}
              onPointerUp={() => setReveal(false)}
              onPointerLeave={() => setReveal(false)}
              onPointerCancel={() => setReveal(false)}
            />
            {status === 'loading' && (
              <div className="absolute inset-0 flex items-center justify-center p-5 text-center text-xs text-muted-foreground">
                reading the photo, building the depth map
              </div>
            )}
            {status === 'error' && (
              <div className="absolute inset-0 flex items-center justify-center p-5 text-center text-xs text-destructive">
                {error}
              </div>
            )}
            {dragging && (
              <div className="pointer-events-none absolute inset-3 z-10 flex items-center justify-center rounded-xl border border-dashed border-ring bg-background/70 text-[13px] tracking-wide">
                drop a photo to load it
              </div>
            )}
            {recording && (
              <div className="absolute left-4 top-4 z-10 flex items-center gap-2 rounded-full border border-border bg-background/80 px-3 py-1.5 text-xs">
                <span className="rec-dot size-2 rounded-full bg-destructive" />
                rendering video
              </div>
            )}
          </div>
          {status === 'ready' && (
            <div id="tour-transport" className="flex shrink-0 items-center justify-center gap-2 px-4 pb-4">
              <Button
                id="tour-playmain"
                variant="secondary"
                size="sm"
                onClick={startPlayback}
                title={playing ? 'stop the sweep' : 'sweep the reveal in the chosen direction'}
              >
                {playing ? <Square /> : <Play />}
                {playing ? 'stop' : 'play'}
              </Button>
              <Button
                id="tour-hold"
                variant="secondary"
                size="sm"
                title="hold to see the original"
                onPointerDown={() => setReveal(true)}
                onPointerUp={() => setReveal(false)}
                onPointerLeave={() => setReveal(false)}
                onPointerCancel={() => setReveal(false)}
                onKeyDown={(e) => {
                  if (e.key === ' ' || e.key === 'Enter') setReveal(true)
                }}
                onKeyUp={(e) => {
                  if (e.key === ' ' || e.key === 'Enter') setReveal(false)
                }}
                onBlur={() => setReveal(false)}
              >
                <Eye />
                {revealing ? 'original' : 'hold to see the original'}
              </Button>
            </div>
          )}
        </section>
        <Controls
          value={params}
          onChange={patch}
          onExport={exportPng}
          onExportVideo={exportVideo}
          onExportLoop={exportLoop}
          recording={recording}
          onSaveDepth={saveDepth}
          onAIDepth={() => runAIDepthFor(imageRef.current)}
          aiBusy={!!aiBusy}
          onPlay={startPlayback}
          playing={playing}
        />
      </main>
      <Tour open={tourOpen} onClose={() => setTourOpen(false)} />
    </div>
  )
}

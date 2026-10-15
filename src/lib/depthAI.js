// Depth. On a hosted origin the photo goes to /api/depth, a serverless
// function that carries the quantized Depth Anything V2 (small) model inside
// its own bundle, so visitors download nothing. The browser copy below is
// the fallback: it powers the local file build and covers an unreachable
// function. WebGPU is used where it exists, wasm otherwise.

const CDN = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3/+esm'

let libPromise = null
let pipePromise = null

function loadLib() {
  if (!libPromise) {
    libPromise = import(/* @vite-ignore */ CDN)
  }
  return libPromise
}

// Each rung is tried until one loads. The quantized weights (about 26 MB)
// are the default on both the GPU and wasm; half precision only shows up as
// a fallback if the quantized file refuses to load. Missing weight files or
// an unwilling GPU just move on.
const LADDER = [
  ['webgpu', 'q8'],
  ['wasm', 'q8'],
  ['webgpu', 'fp16'],
  ['wasm', ''],
]

export function loadDepthPipeline(onStatus) {
  if (pipePromise) return pipePromise
  pipePromise = (async () => {
    const mod = await loadLib()
    let lastError = null
    for (const [device, dtype] of LADDER) {
      if (device === 'webgpu' && !(typeof navigator !== 'undefined' && navigator.gpu)) continue
      try {
        const options = { device, progress_callback: (p) => onStatus && onStatus(p) }
        if (dtype) options.dtype = dtype
        return await mod.pipeline('depth-estimation', 'onnx-community/depth-anything-v2-small', options)
      } catch (err) {
        lastError = err
      }
    }
    throw lastError || new Error('could not load the depth model')
  })()
  pipePromise.catch(() => {
    pipePromise = null
  })
  return pipePromise
}

// Sends the photo to the serverless function and gets the depth map back as
// a PNG. Nothing to download on the client side.
async function runServerDepth(source, onStatus) {
  const srcW = source.naturalWidth || source.width
  const srcH = source.naturalHeight || source.height
  const maxSide = 1024
  const scale = Math.min(1, maxSide / Math.max(srcW, srcH))
  const w = Math.max(16, Math.round(srcW * scale))
  const h = Math.max(16, Math.round(srcH * scale))

  const input = document.createElement('canvas')
  input.width = w
  input.height = h
  input.getContext('2d').drawImage(source, 0, 0, w, h)
  const blob = await new Promise((resolve, reject) => {
    input.toBlob((b) => (b ? resolve(b) : reject(new Error('could not encode the photo'))), 'image/jpeg', 0.92)
  })

  if (onStatus) onStatus({ stage: 'run' })
  const resp = await fetch('/api/depth', {
    method: 'POST',
    headers: { 'content-type': blob.type || 'image/jpeg' },
    body: blob,
  })
  if (!resp.ok) throw new Error(`the depth service answered ${resp.status}`)
  const out = await resp.blob()
  const bitmap = await createImageBitmap(out)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  canvas.getContext('2d').drawImage(bitmap, 0, 0)
  if (bitmap.close) bitmap.close()
  return stretchToDepth(canvas)
}

// Runs the model over any image and returns a grayscale depth canvas,
// stretched to the full range the way the offline pipeline writes its maps.
export async function runAIDepth(source, onStatus) {
  if (typeof location !== 'undefined' && (location.protocol === 'http:' || location.protocol === 'https:')) {
    try {
      return await runServerDepth(source, onStatus)
    } catch (err) {
      // the service can be down or unreachable; the local model takes over
    }
  }
  const mod = await loadLib()
  const pipe = await loadDepthPipeline(onStatus)

  const srcW = source.naturalWidth || source.width
  const srcH = source.naturalHeight || source.height
  const maxSide = 1024
  const scale = Math.min(1, maxSide / Math.max(srcW, srcH))
  const w = Math.max(16, Math.round(srcW * scale))
  const h = Math.max(16, Math.round(srcH * scale))

  const input = document.createElement('canvas')
  input.width = w
  input.height = h
  const ctx = input.getContext('2d')
  ctx.drawImage(source, 0, 0, w, h)
  const data = ctx.getImageData(0, 0, w, h).data

  if (onStatus) onStatus({ stage: 'run' })
  const image = new mod.RawImage(new Uint8ClampedArray(data.buffer.slice(0)), w, h, 4)
  const out = await pipe(image)
  const depthImage = out && out.depth
  if (!depthImage || !depthImage.toCanvas) throw new Error('the model returned no depth map')
  const raw = depthImage.toCanvas()
  return stretchToDepth(raw)
}

function stretchToDepth(srcCanvas) {
  const w = srcCanvas.width
  const h = srcCanvas.height
  const n = w * h
  const ctx = srcCanvas.getContext('2d', { willReadFrequently: true })
  const data = ctx.getImageData(0, 0, w, h).data

  const gray = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const p = i * 4
    gray[i] = (0.2126 * data[p] + 0.7152 * data[p + 1] + 0.0722 * data[p + 2]) / 255
  }

  const sorted = Float32Array.from(gray).sort()
  const lo = sorted[Math.floor(n * 0.02)]
  const hi = sorted[Math.min(n - 1, Math.floor(n * 0.98))]
  const span = Math.max(1e-5, hi - lo)

  const out = ctx.createImageData(w, h)
  for (let i = 0; i < n; i++) {
    let v = (gray[i] - lo) / span
    v = v < 0 ? 0 : v > 1 ? 1 : v
    const px = Math.round(v * 255)
    const o = i * 4
    out.data[o] = px
    out.data[o + 1] = px
    out.data[o + 2] = px
    out.data[o + 3] = 255
  }

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  canvas.getContext('2d').putImageData(out, 0, 0)
  return canvas
}

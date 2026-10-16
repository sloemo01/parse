// Depth. On a hosted origin the pixels go to /api/depth, a serverless
// function that carries the quantized Depth Anything V2 (small) model inside
// its own bundle, so visitors download nothing. The browser copy below is
// the fallback: it powers the local file build and covers an unreachable
// function. WebGPU is used where it exists, wasm otherwise.
import { POW_BITS, powChallenge, sha256Hex, solvePow } from './pow.js'

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

// Sends the drawn pixels straight to the serverless function and gets the
// depth map back as raw grayscale. No image formats on the wire, so nothing
// on either side has to decode or encode a picture.
async function runServerDepth(source, onStatus) {
  const srcW = source.naturalWidth || source.width
  const srcH = source.naturalHeight || source.height
  const maxSide = 768
  const scale = Math.min(1, maxSide / Math.max(srcW, srcH))
  const w = Math.max(16, Math.round(srcW * scale))
  const h = Math.max(16, Math.round(srcH * scale))

  const input = document.createElement('canvas')
  input.width = w
  input.height = h
  const ictx = input.getContext('2d')
  ictx.imageSmoothingQuality = 'high'
  ictx.drawImage(source, 0, 0, w, h)
  const pixels = ictx.getImageData(0, 0, w, h).data
  const rgb = new Uint8Array(w * h * 3)
  for (let i = 0, j = 0; j < rgb.length; i += 4, j += 3) {
    rgb[j] = pixels[i]
    rgb[j + 1] = pixels[i + 1]
    rgb[j + 2] = pixels[i + 2]
  }

  if (onStatus) onStatus({ stage: 'run' })
  // Proof of work: the server wants a nonce hashed against this exact body
  // and the current hour, so one real request costs a moment of compute and
  // a flood pays that compute for every single call.
  const bucket = Math.floor(Date.now() / 3600000)
  const nonce = solvePow(powChallenge(bucket, sha256Hex(rgb)), POW_BITS)
  const resp = await fetch('/api/depth', {
    method: 'POST',
    headers: {
      'content-type': 'application/octet-stream',
      'x-parse-w': String(w),
      'x-parse-h': String(h),
      'x-parse-pow': `${bucket}.${nonce}`,
    },
    body: rgb,
  })
  if (!resp.ok) throw new Error(`the depth service answered ${resp.status}`)
  const dw = Number(resp.headers.get('x-depth-w'))
  const dh = Number(resp.headers.get('x-depth-h'))
  const grey = new Uint8Array(await resp.arrayBuffer())
  if (!dw || !dh || grey.length !== dw * dh) throw new Error('the depth map came back malformed')
  const out = document.createElement('canvas')
  out.width = dw
  out.height = dh
  const octx = out.getContext('2d')
  const img = octx.createImageData(dw, dh)
  for (let i = 0, j = 0; i < grey.length; i++, j += 4) {
    img.data[j] = grey[i]
    img.data[j + 1] = grey[i]
    img.data[j + 2] = grey[i]
    img.data[j + 3] = 255
  }
  octx.putImageData(img, 0, 0)
  return stretchToDepth(out)
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
    // The model reads distance as brightness (near is bright) while the maps
    // the shader ships with keep the far side bright, so flip to match.
    const px = Math.round((1 - v) * 255)
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

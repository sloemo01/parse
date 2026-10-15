// Estimates a depth map for the bundled photo with Depth Anything V2 through
// transformers.js, then writes a grayscale PNG the shader can use.
//
//   npm run depth
//
// First run downloads the ONNX model into the Hugging Face cache.

import { writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pipeline, RawImage } from '@huggingface/transformers'
import sharp from 'sharp'
import { PNG } from 'pngjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const photoPath = resolve(root, 'src/assets/pexels-kaplanart-10776642.jpg')
const outPath = resolve(root, 'src/assets/depth.png')

console.log(`reading ${photoPath}`)
const { data: rgba, info } = await sharp(photoPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
const image = new RawImage(
  new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.byteLength),
  info.width,
  info.height,
  4
)
console.log(`photo ${info.width} x ${info.height}`)

// Large first for the most detail, then progressively smaller variants if a
// download or the model itself is unavailable.
const attempts = [
  ['onnx-community/depth-anything-v2-large', { dtype: 'q8' }],
  ['onnx-community/depth-anything-v2-large', { dtype: 'fp32' }],
  ['onnx-community/depth-anything-v2-base', { dtype: 'fp32' }],
  ['onnx-community/depth-anything-v2-small', { dtype: 'fp32' }],
]

let estimator = null
for (const [model, options] of attempts) {
  try {
    console.log(`loading ${model} (${options.dtype || 'default'}) ...`)
    estimator = await pipeline('depth-estimation', model, options)
    console.log(`loaded ${model}`)
    break
  } catch (err) {
    const msg = err && err.message ? String(err.message) : String(err)
    console.log(`failed to load ${model}: ${msg.slice(0, 300)}`)
  }
}
if (!estimator) throw new Error('no depth model could be loaded')

console.log('running inference ...')
const result = await estimator(image)
const d = result.depth ?? result.predicted_depth
if (!d) throw new Error('depth model returned nothing useful')

let W
let H
let raw
if (d.width && d.data) {
  W = d.width
  H = d.height
  const ch = d.channels || 1
  raw = new Float32Array(W * H)
  for (let i = 0; i < W * H; i++) raw[i] = d.data[i * ch]
} else if (d.dims) {
  H = d.dims[0]
  W = d.dims[1]
  raw = Float32Array.from(d.data)
} else {
  throw new Error('unexpected depth output shape')
}
const n = raw.length
console.log(`depth ${W} x ${H}`)

// Percentile stretch to 0..1.
const sorted = Float32Array.from(raw).sort()
const lo = sorted[Math.floor(n * 0.01)]
const hi = sorted[Math.min(n - 1, Math.floor(n * 0.99))]
const span = Math.max(1e-6, hi - lo)
for (let i = 0; i < n; i++) {
  const v = (raw[i] - lo) / span
  raw[i] = v < 0 ? 0 : v > 1 ? 1 : v
}

// Orientation: for this photo the sky sits at the top and the water at the
// bottom, so a far-is-bright map should have the brighter band at the top.
// Flip the map if the model disagrees.
const band = Math.max(1, Math.round(H * 0.1))
let topSum = 0
let bottomSum = 0
for (let y = 0; y < band; y++) for (let x = 0; x < W; x++) topSum += raw[y * W + x]
for (let y = H - band; y < H; y++) for (let x = 0; x < W; x++) bottomSum += raw[y * W + x]
const flip = topSum < bottomSum
console.log(
  `top ${(topSum / (band * W)).toFixed(3)} bottom ${(bottomSum / (band * W)).toFixed(3)} flip=${flip}`
)
if (flip) for (let i = 0; i < n; i++) raw[i] = 1 - raw[i]

// Detail injection: the model works at a low internal resolution and smooths
// out fine texture like the water surface. Blend the photo's local
// high-frequency luminance back into the depth so ripples, foam and grain
// show up in the gradient and along the reveal front.
console.log('injecting photo detail ...')
const { data: photoRGBA } = await sharp(photoPath)
  .resize(W, H)
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true })
const luma = new Float32Array(n)
for (let i = 0; i < n; i++) {
  const p = i * 4
  luma[i] = (0.2126 * photoRGBA[p] + 0.7152 * photoRGBA[p + 1] + 0.0722 * photoRGBA[p + 2]) / 255
}
const softLuma = boxBlur(luma, W, H, 24)
for (let i = 0; i < n; i++) {
  const v = raw[i] + (luma[i] - softLuma[i]) * 0.3
  raw[i] = v < 0 ? 0 : v > 1 ? 1 : v
}

writeGray(outPath, raw)
console.log(`wrote ${outPath}`)

// A heavily smoothed copy drives the reveal wipe: the front then sweeps the
// whole scene consistently instead of wrapping around small objects like the
// bird. It is also histogram-equalized so the reveal progresses evenly across
// the image: 50% on the slider reveals the nearest half of the pixels. The
// detailed map above stays for the ramp and the depth view.
const softRaw = boxBlur(raw, W, H, 45)
const hist = new Uint32Array(2048)
for (let i = 0; i < n; i++) hist[Math.min(2047, Math.floor(softRaw[i] * 2047))]++
const cdf = new Float32Array(2048)
let acc = 0
for (let b = 0; b < 2048; b++) {
  acc += hist[b]
  cdf[b] = acc / n
}
const softEq = new Float32Array(n)
for (let i = 0; i < n; i++) softEq[i] = cdf[Math.min(2047, Math.floor(softRaw[i] * 2047))]
const softPath = outPath.replace(/depth\.png$/, 'depth-soft.png')
writeGray(softPath, softEq)
console.log(`wrote ${softPath}`)

function writeGray(path, arr) {
  const png = new PNG({ width: W, height: H })
  for (let i = 0; i < arr.length; i++) {
    const px = Math.round(arr[i] * 255)
    const o = i * 4
    png.data[o] = px
    png.data[o + 1] = px
    png.data[o + 2] = px
    png.data[o + 3] = 255
  }
  writeFileSync(path, PNG.sync.write(png))
}

function boxBlur(src, w, h, r) {
  const a = Float32Array.from(src)
  const b = new Float32Array(src.length)
  const d = 2 * r + 1
  const cl = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < h; y++) {
      const row = y * w
      let sum = 0
      for (let x = -r; x <= r; x++) sum += a[row + cl(x, 0, w - 1)]
      for (let x = 0; x < w; x++) {
        b[row + x] = sum / d
        sum += a[row + cl(x + r + 1, 0, w - 1)] - a[row + cl(x - r, 0, w - 1)]
      }
    }
    for (let x = 0; x < w; x++) {
      let sum = 0
      for (let y = -r; y <= r; y++) sum += b[cl(y, 0, h - 1) * w + x]
      for (let y = 0; y < h; y++) {
        a[y * w + x] = sum / d
        sum += b[cl(y + r + 1, 0, h - 1) * w + x] - b[cl(y - r, 0, h - 1) * w + x]
      }
    }
  }
  return a
}

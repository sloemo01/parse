function clampInt(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v
}

function boxBlur(src, w, h, r) {
  const a = Float32Array.from(src)
  const b = new Float32Array(src.length)
  const d = 2 * r + 1
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < h; y++) {
      const row = y * w
      let sum = 0
      for (let x = -r; x <= r; x++) sum += a[row + clampInt(x, 0, w - 1)]
      for (let x = 0; x < w; x++) {
        b[row + x] = sum / d
        sum += a[row + clampInt(x + r + 1, 0, w - 1)] - a[row + clampInt(x - r, 0, w - 1)]
      }
    }
    for (let x = 0; x < w; x++) {
      let sum = 0
      for (let y = -r; y <= r; y++) sum += b[clampInt(y, 0, h - 1) * w + x]
      for (let y = 0; y < h; y++) {
        a[y * w + x] = sum / d
        sum += b[clampInt(y + r + 1, 0, h - 1) * w + x] - b[clampInt(y - r, 0, h - 1) * w + x]
      }
    }
  }
  return a
}

// Cheap stand-in for a monocular depth estimate: luminance, a mild vertical
// prior (sky reads far, foreground reads near), two blur passes, then a 2 to
// 98 percentile stretch so the map uses the full 0..1 range.
export function buildDepthMap(img, width = 512, blurRadius = 10) {
  const w = Math.max(16, Math.round(width))
  const srcW = img.naturalWidth || img.width
  const srcH = img.naturalHeight || img.height
  const h = Math.max(16, Math.round((w * srcH) / srcW))

  const srcCanvas = document.createElement('canvas')
  srcCanvas.width = w
  srcCanvas.height = h
  const srcCtx = srcCanvas.getContext('2d', { willReadFrequently: true })
  srcCtx.drawImage(img, 0, 0, w, h)
  const data = srcCtx.getImageData(0, 0, w, h).data

  const n = w * h
  const gray = new Float32Array(n)
  const vPrior = 0.22
  for (let y = 0; y < h; y++) {
    const far = 1 - y / (h - 1)
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const p = i * 4
      const lum = (0.2126 * data[p] + 0.7152 * data[p + 1] + 0.0722 * data[p + 2]) / 255
      gray[i] = lum * (1 - vPrior) + far * vPrior
    }
  }

  const blurred = boxBlur(gray, w, h, blurRadius)
  const sorted = Float32Array.from(blurred).sort()
  const lo = sorted[Math.floor(n * 0.02)]
  const hi = sorted[Math.min(n - 1, Math.floor(n * 0.98))]
  const span = Math.max(1e-5, hi - lo)

  const out = srcCtx.createImageData(w, h)
  for (let i = 0; i < n; i++) {
    const v = (blurred[i] - lo) / span
    const px = Math.round((v < 0 ? 0 : v > 1 ? 1 : v) * 255)
    const o = i * 4
    out.data[o] = px
    out.data[o + 1] = px
    out.data[o + 2] = px
    out.data[o + 3] = 255
  }

  const depthCanvas = document.createElement('canvas')
  depthCanvas.width = w
  depthCanvas.height = h
  depthCanvas.getContext('2d').putImageData(out, 0, 0)
  return depthCanvas
}

// The wipe reads a heavily blurred, histogram equalized copy of the depth
// map so the reveal front sweeps evenly and never wraps around small
// objects. Mirrors what the offline pipeline writes as depth-soft.png.
export function buildDepthSoft(depthCanvas) {
  const w = depthCanvas.width
  const h = depthCanvas.height
  const n = w * h
  const ctx = depthCanvas.getContext('2d', { willReadFrequently: true })
  const data = ctx.getImageData(0, 0, w, h).data

  const gray = new Float32Array(n)
  for (let i = 0; i < n; i++) gray[i] = data[i * 4] / 255

  const radius = Math.max(4, Math.round(w / 34))
  const blurred = boxBlur(gray, w, h, radius)

  const hist = new Uint32Array(2048)
  for (let i = 0; i < n; i++) hist[Math.min(2047, Math.floor(blurred[i] * 2047))]++
  const cdf = new Float32Array(2048)
  let acc = 0
  for (let b = 0; b < 2048; b++) {
    acc += hist[b]
    cdf[b] = acc / n
  }

  const out = ctx.createImageData(w, h)
  for (let i = 0; i < n; i++) {
    const px = Math.round(cdf[Math.min(2047, Math.floor(blurred[i] * 2047))] * 255)
    const o = i * 4
    out.data[o] = px
    out.data[o + 1] = px
    out.data[o + 2] = px
    out.data[o + 3] = 255
  }

  const softCanvas = document.createElement('canvas')
  softCanvas.width = w
  softCanvas.height = h
  softCanvas.getContext('2d').putImageData(out, 0, 0)
  return softCanvas
}

export function buildDepthPair(img) {
  const depth = buildDepthMap(img)
  return { depth, soft: buildDepthSoft(depth) }
}

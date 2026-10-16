// Depth inference without a framework: the quantized Depth Anything V2
// (small) model runs on onnxruntime directly. Both the weights and the
// runtime ride along with the site as static files and land in /tmp once
// per cold instance, so the function bundle stays tiny while visitors still
// download nothing (every fetch here is server side). The preprocessing
// mirrors the model's own DPT image processor: shortest side to 518, the
// other side rounded to a multiple of 14, rescale to 0..1, normalize with
// the ImageNet mean/std.
import path from 'node:path'
import http from 'node:http'
import https from 'node:https'
import { createRequire } from 'node:module'
import { chmodSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { brotliDecompressSync } from 'node:zlib'

const DEFAULT_MODEL = path.join(
  process.cwd(),
  'models/onnx-community/depth-anything-v2-small/onnx/model_quantized.onnx',
)
// Bump the v when the weights change so stale caches never linger.
const CACHE_PATH = '/tmp/parse-depth-model-v1.onnx'
const RUNTIME_DIR = `/tmp/parse-ort-${process.platform}-${process.arch}`
const WORK_SIDE = 518 // the processor's working size
const MULTIPLE = 14 // and its size divisor
const MEAN = [0.485, 0.456, 0.406]
const STD = [0.229, 0.224, 0.225]

let sessionPromise = null
let modelPromise = null
let ortPromise = null
let runtimePromise = null

// A plain download helper (node:http, not fetch): the runtime's undici has
// thrown under the dev server, and this path only ever does simple GETs.
function httpGet(url, redirects = 3) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const mod = u.protocol === 'http:' ? http : https
    const req = mod.get(u, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        res.resume()
        resolve(httpGet(new URL(res.headers.location, u).toString(), redirects - 1))
        return
      }
      if (res.statusCode !== 200) {
        res.resume()
        reject(new Error(`download answered ${res.statusCode}`))
        return
      }
      const chunks = []
      let size = 0
      res.on('data', (c) => {
        chunks.push(c)
        size += c.length
      })
      res.on('end', () => resolve(Buffer.concat(chunks, size)))
      res.on('error', reject)
    })
    req.on('error', reject)
    req.end()
  })
}

// The weights ride along with the site as a static file and land in /tmp
// once per cold instance. That keeps about 26 MB out of every function
// bundle while visitors still download nothing, the fetch is server side.
function ensureModel(url) {
  if (!modelPromise) {
    modelPromise = (async () => {
      if (url) {
        try {
          if (existsSync(CACHE_PATH) && statSync(CACHE_PATH).size > 1e6) return CACHE_PATH
          const buf = await httpGet(url)
          if (buf.length < 1e6) throw new Error('model download came back short')
          await writeFile(CACHE_PATH, buf)
          return CACHE_PATH
        } catch (err) {
          if (existsSync(DEFAULT_MODEL)) return DEFAULT_MODEL
          throw err
        }
      }
      return DEFAULT_MODEL
    })()
    modelPromise.catch(() => {
      modelPromise = null
    })
  }
  return modelPromise
}

// A tiny ustar reader: enough for the archive our own build script writes,
// which is flat paths with no long names, links or special entries.
function untar(buf, destDir) {
  let off = 0
  while (off + 512 <= buf.length) {
    const header = buf.subarray(off, off + 512)
    if (header.every((b) => b === 0)) break
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '')
    const size = parseInt(header.subarray(124, 136).toString('utf8').replace(/\0.*$/, '').trim() || '0', 8)
    const type = String.fromCharCode(header[156])
    off += 512
    if (!name) break
    const bodyStart = off
    off += Math.ceil(size / 512) * 512
    if (name.includes('..') || name.startsWith('/')) continue
    if (type !== '0' && type !== '\0' && type !== '') continue
    const target = path.join(destDir, name)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, buf.subarray(bodyStart, bodyStart + size))
    if (name.endsWith('.node') || name.includes('.so')) chmodSync(target, 0o755)
  }
}

// The runtime (engine binary plus its small JS wrapper) rides the static
// side the same way the weights do and gets unpacked per cold instance.
function ensureRuntime(url) {
  if (!runtimePromise) {
    runtimePromise = (async () => {
      const marker = path.join(RUNTIME_DIR, 'node_modules/onnxruntime-node/package.json')
      if (existsSync(marker)) return RUNTIME_DIR
      const packed = await httpGet(url)
      if (packed.length < 1e5) throw new Error('runtime download came back short')
      const tar = brotliDecompressSync(packed)
      mkdirSync(RUNTIME_DIR, { recursive: true })
      untar(tar, RUNTIME_DIR)
      return RUNTIME_DIR
    })()
    runtimePromise.catch(() => {
      runtimePromise = null
    })
  }
  return runtimePromise
}

// On a deployment the runtime comes from the archive; local runs (tools,
// offline scripts) fall back to the installed package. The specifier rides
// a variable so the function tracer leaves the package out of the bundle.
function loadORT(runtimeUrl) {
  if (!ortPromise) {
    ortPromise = (async () => {
      if (runtimeUrl) {
        try {
          const dir = await ensureRuntime(runtimeUrl)
          const req = createRequire(path.join(dir, 'entry.cjs'))
          const pkg = 'onnxruntime-node'
          return req(pkg)
        } catch (err) {
          // fall through to the installed copy
        }
      }
      const pkg = 'onnxruntime-node'
      return import(pkg)
    })()
    ortPromise.catch(() => {
      ortPromise = null
    })
  }
  return ortPromise
}

function getSession(modelUrl, runtimeUrl) {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const ort = await loadORT(runtimeUrl)
      const modelPath = await ensureModel(modelUrl)
      const session = await ort.InferenceSession.create(modelPath)
      return { session, ort }
    })()
    sessionPromise.catch(() => {
      sessionPromise = null
    })
  }
  return sessionPromise
}

// The processor's geometry: shortest side to 518, other side scaled by the
// same ratio and rounded to the nearest multiple of 14.
export function workSize(w, h) {
  const scale = WORK_SIDE / Math.min(w, h)
  const outW = Math.max(MULTIPLE, Math.round((w * scale) / MULTIPLE) * MULTIPLE)
  const outH = Math.max(MULTIPLE, Math.round((h * scale) / MULTIPLE) * MULTIPLE)
  return { outW, outH }
}

// PIL's bicubic filter, a = -0.5, with PIL's downscale handling: the support
// widens when scaling down so the result matches PIL-based preprocessing.
function bicubicWeight(t) {
  const a = -0.5
  t = Math.abs(t)
  if (t < 1) return ((a + 2) * t - (a + 3)) * t * t + 1
  if (t < 2) return ((a * t - 5 * a) * t + 8 * a) * t - 4 * a
  return 0
}

// The output step in the pipeline is `interpolate_4d` with bilinear and
// align_corners=false, ported here exactly so the depth map matches.
function bilinear(src, sw, sh, dw, dh) {
  const out = new Float32Array(dw * dh)
  const xScale = dw / sw
  const yScale = dh / sh
  for (let i = 0; i < dh; i++) {
    for (let j = 0; j < dw; j++) {
      const x = (j + 0.5) / xScale - 0.5
      const y = (i + 0.5) / yScale - 0.5
      let x1 = Math.floor(x)
      let y1 = Math.floor(y)
      const x2 = Math.min(x1 + 1, sw - 1)
      const y2 = Math.min(y1 + 1, sh - 1)
      x1 = Math.max(x1, 0)
      y1 = Math.max(y1, 0)
      const s = x - x1
      const t = y - y1
      const w1 = (1 - s) * (1 - t)
      const w2 = s * (1 - t)
      const w3 = (1 - s) * t
      const w4 = s * t
      out[i * dw + j] = w1 * src[y1 * sw + x1] + w2 * src[y1 * sw + x2] + w3 * src[y2 * sw + x1] + w4 * src[y2 * sw + x2]
    }
  }
  return out
}

function resample(src, sw, sh, dw, dh) {
  const out = new Float32Array(dw * dh)

  function coeffs(dstSize, srcSize) {
    const scale = dstSize / srcSize
    const filterscale = scale < 1 ? 1 / scale : 1
    const support = 2 * filterscale
    const rows = []
    for (let x = 0; x < dstSize; x++) {
      const center = (x + 0.5) / scale - 0.5
      const xmin = Math.max(0, Math.ceil(center - support + 0.5))
      const xmax = Math.min(srcSize, Math.floor(center + support + 0.5))
      const ws = []
      let sum = 0
      for (let i = xmin; i < xmax; i++) {
        const wgt = bicubicWeight((i - center + 0.5) / filterscale)
        ws.push([i, wgt])
        sum += wgt
      }
      if (sum !== 0) for (const p of ws) p[1] /= sum
      rows.push({ xmin, ws })
    }
    return rows
  }

  const cx = coeffs(dw, sw)
  const cy = coeffs(dh, sh)
  const tmp = new Float32Array(dw * sh)
  for (let y = 0; y < sh; y++) {
    const row = y * sw
    for (let x = 0; x < dw; x++) {
      const c = cx[x]
      let sum = 0
      for (const [i, wgt] of c.ws) sum += src[row + i] * wgt
      tmp[y * dw + x] = sum
    }
  }
  for (let y = 0; y < dh; y++) {
    const c = cy[y]
    const row = y * dw
    for (let x = 0; x < dw; x++) {
      let sum = 0
      for (const [i, wgt] of c.ws) sum += tmp[i * dw + x] * wgt
      out[row + x] = sum
    }
  }
  return out
}

// Runs the model over raw rgb bytes and returns raw grayscale depth at the
// same size, stretched to the full range the way the old pipeline wrote it.
export async function runDepth(rgb, w, h, modelUrl, runtimeUrl) {
  const { outW, outH } = workSize(w, h)

  // deinterleave to float planes at the working size
  const r = new Float32Array(w * h)
  const g = new Float32Array(w * h)
  const b = new Float32Array(w * h)
  for (let i = 0, j = 0; i < w * h; i++, j += 3) {
    r[i] = rgb[j]
    g[i] = rgb[j + 1]
    b[i] = rgb[j + 2]
  }
  const planes = [resample(r, w, h, outW, outH), resample(g, w, h, outW, outH), resample(b, w, h, outW, outH)]

  // NCHW float tensor, rescaled and normalized the way the processor does
  const chw = new Float32Array(3 * outW * outH)
  for (let c = 0; c < 3; c++) {
    const plane = planes[c]
    const off = c * outW * outH
    for (let i = 0; i < plane.length; i++) {
      chw[off + i] = (plane[i] / 255 - MEAN[c]) / STD[c]
    }
  }

  const { session, ort } = await getSession(modelUrl, runtimeUrl)
  const out = await session.run({ pixel_values: new ort.Tensor('float32', chw, [1, 3, outH, outW]) })
  const depth = out.predicted_depth.data

  let lo = Infinity
  let hi = -Infinity
  for (let i = 0; i < depth.length; i++) {
    if (depth[i] < lo) lo = depth[i]
    if (depth[i] > hi) hi = depth[i]
  }
  const span = Math.max(1e-5, hi - lo)
  const norm = new Float32Array(depth.length)
  for (let i = 0; i < depth.length; i++) norm[i] = (depth[i] - lo) / span

  const sized = bilinear(norm, outW, outH, w, h)
  const grey = new Uint8Array(w * h)
  for (let i = 0; i < grey.length; i++) {
    // the pipeline's mul_(255).to('uint8') truncates, it does not round
    let v = sized[i] * 255
    v = (v < 0 ? 0 : v > 255 ? 255 : v) | 0
    grey[i] = v
  }
  return { width: w, height: h, data: grey }
}

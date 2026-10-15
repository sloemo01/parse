// Serverless depth: the deployed site posts a photo here and gets a depth
// map back. The quantized model lives inside this function's bundle, so
// visitors never download it. The browser only falls back to its own copy
// when this endpoint is unreachable.
//
// Abuse guards, cheapest first: same origin only, body cap, per IP throttle,
// then a proof of work bound to the exact photo bytes and the hour, so a
// flood pays real compute per request.
import path from 'node:path'
import sharp from 'sharp'
import { pipeline, env, RawImage } from '@huggingface/transformers'
import { POW_BITS, powChallenge, sha256Hex, verifyPow } from '../src/lib/pow.js'

env.allowRemoteModels = false
env.allowLocalModels = true
env.localModelPath = path.join(process.cwd(), 'models')
env.cacheDir = '/tmp'

const MODEL_ID = 'onnx-community/depth-anything-v2-small'
const MAX_SIDE = 768
const ALLOWED_ORIGIN = 'https://parse-sloemos-projects.vercel.app'
const MAX_BODY = 6 * 1024 * 1024
const WINDOW_MS = 10 * 60 * 1000
const MAX_RUNS = 10

let pipePromise = null

// Warm instance scope only, which is exactly the window an attacker on one
// instance gets. Anything beyond that is Vercel's DDoS layer territory.
const hits = new Map()

function rateLimited(ip) {
  const now = Date.now()
  const list = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS)
  if (list.length >= MAX_RUNS) {
    hits.set(ip, list)
    return true
  }
  list.push(now)
  hits.set(ip, list)
  if (hits.size > 5000) {
    for (const [key, times] of hits) {
      if (!times.length || now - times[times.length - 1] > WINDOW_MS) hits.delete(key)
    }
  }
  return false
}

function getPipeline() {
  if (!pipePromise) {
    pipePromise = pipeline('depth-estimation', MODEL_ID, { dtype: 'q8', device: 'cpu' })
  }
  return pipePromise
}

async function readBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return Buffer.concat(chunks)
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' })
    return
  }

  // Browsers always send Origin on our own page's fetches, so anything
  // without it is not the site talking.
  if ((req.headers.origin || '') !== ALLOWED_ORIGIN) {
    res.status(403).json({ error: 'same origin only' })
    return
  }

  const declared = Number(req.headers['content-length'] || 0)
  if (declared > MAX_BODY) {
    res.status(413).json({ error: 'photo too large' })
    return
  }

  const ip = String(req.headers['x-forwarded-for'] || (req.socket && req.socket.remoteAddress) || 'unknown')
    .split(',')[0]
    .trim()
  if (rateLimited(ip)) {
    res.status(429).json({ error: 'too many depth runs from this address, try again later' })
    return
  }

  try {
    const body = await readBody(req)
    if (!body.length) {
      res.status(400).json({ error: 'no image in the request' })
      return
    }
    if (body.length > MAX_BODY) {
      res.status(413).json({ error: 'photo too large' })
      return
    }

    // The proof of work: prefix, hour bucket, and a hash of the exact body
    // bytes the client is about to send. One hour of slack for clock drift.
    const powHeader = String(req.headers['x-parse-pow'] || '')
    const dot = powHeader.indexOf('.')
    const bucket = Number(dot > 0 ? powHeader.slice(0, dot) : NaN)
    const nonce = dot > 0 ? powHeader.slice(dot + 1) : ''
    const nowBucket = Math.floor(Date.now() / 3600000)
    if (!nonce || !Number.isFinite(bucket) || (bucket !== nowBucket && bucket !== nowBucket - 1)) {
      res.status(422).json({ error: 'missing or stale proof of work' })
      return
    }
    if (!verifyPow(powChallenge(bucket, sha256Hex(body)), nonce, POW_BITS)) {
      res.status(422).json({ error: 'bad proof of work' })
      return
    }

    const { data, info } = await sharp(body)
      .rotate()
      .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })

    const image = new RawImage(new Uint8ClampedArray(data), info.width, info.height, info.channels)
    const pipe = await getPipeline()
    const { depth } = await pipe(image)

    const png = await sharp(Buffer.from(depth.data), {
      raw: { width: depth.width, height: depth.height, channels: depth.channels },
    })
      .png({ compressionLevel: 6 })
      .toBuffer()

    res.setHeader('content-type', 'image/png')
    res.setHeader('cache-control', 'no-store')
    res.status(200).send(png)
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) })
  }
}

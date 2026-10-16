// Serverless depth: the deployed site posts raw RGB pixels here and gets a
// grayscale depth map back. No image decoder lives in here, on either side
// of the model: the canvas that draws the page already produced these pixels.
// onnxruntime drives the quantized model straight from depthCore, and the
// weights live inside this function's bundle, so visitors never download
// anything. The browser only falls back to its own copy when this endpoint
// is unreachable.
//
// Abuse guards, cheapest first: same origin only (origin plus the browser's
// own fetch signals), body cap, per IP throttle, then a proof of work bound
// to the exact pixel bytes and the hour, so a flood pays real compute per
// request.
import { runDepth } from '../src/lib/depthCore.js'
import { POW_BITS, powChallenge, sha256Hex, verifyPow } from '../src/lib/pow.js'

// The client draws to 768 on the long side; anything up to 1024 is taken as
// is. depthCore resizes to the model's working size from there.
const MAX_PIXEL_SIDE = 1024
const ALLOWED_ORIGIN = 'https://parse-sloemos-projects.vercel.app'
const MAX_BODY = 10 * 1024 * 1024
const WINDOW_MS = 10 * 60 * 1000
const MAX_RUNS = 15

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

async function readBody(req) {
  // Some runtimes hand the body over already buffered on req.body and the
  // stream yields nothing; classic Node (production) streams it instead.
  if (req.body != null) {
    if (Buffer.isBuffer(req.body)) return req.body
    if (req.body instanceof Uint8Array) return Buffer.from(req.body)
    if (req.body instanceof ArrayBuffer) return Buffer.from(new Uint8Array(req.body))
  }
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
  // without it is not the site talking. Localhost only counts under
  // `vercel dev`, never in a deployed environment.
  const origin = req.headers.origin || ''
  // A deployed function always has VERCEL_ENV set (preview or production);
  // only a local `vercel dev` or an offline run leaves it unset.
  const envName = process.env.VERCEL_ENV
  const isDev = (envName == null || envName === 'development') && /^http:\/\/localhost(:\d+)?$/.test(origin)
  if (origin !== ALLOWED_ORIGIN && !isDev) {
    res.status(403).json({ error: 'same origin only' })
    return
  }

  // The browser's own signals: only our page can truthfully claim a
  // same-origin fetch with a referer from the site. Scripts have to forge
  // these by hand, and even then they still owe the proof of work below.
  if ((req.headers['sec-fetch-site'] || '') !== 'same-origin') {
    res.status(403).json({ error: 'same origin only' })
    return
  }
  if (!isDev && !String(req.headers.referer || '').startsWith(`${ALLOWED_ORIGIN}/`)) {
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

    // Raw RGB pixels, no decoder involved: x-parse-w and x-parse-h carry
    // the shape, and the body must be exactly w x h x 3 bytes of it.
    const w = Number(req.headers['x-parse-w'])
    const h = Number(req.headers['x-parse-h'])
    if (
      !Number.isInteger(w) || !Number.isInteger(h) ||
      w < 16 || h < 16 || w > MAX_PIXEL_SIDE || h > MAX_PIXEL_SIDE ||
      w * h * 3 !== body.length
    ) {
      res.status(400).json({ error: 'expected raw rgb pixels, w x h x 3 bytes' })
      return
    }

    // The weights ride along with this deployment as a static file; the
    // function pulls them into /tmp once per cold instance.
    const host = req.headers['x-forwarded-host'] || req.headers.host || ''
    const modelUrl = host ? `${isDev ? 'http' : 'https'}://${host}/model.onnx` : null
    const { width: dw, height: dh, data } = await runDepth(
      new Uint8Array(body.buffer, body.byteOffset, body.length),
      w,
      h,
      modelUrl,
    )

    res.setHeader('content-type', 'application/octet-stream')
    res.setHeader('x-depth-w', String(dw))
    res.setHeader('x-depth-h', String(dh))
    res.setHeader('cache-control', 'no-store')
    res.status(200).send(Buffer.from(data.buffer, data.byteOffset, data.byteLength))
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) })
  }
}

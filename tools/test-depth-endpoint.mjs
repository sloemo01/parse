// Runs the depth endpoint against a local `vercel dev` server (port 3000)
// and checks the reply. Uses the baked payload in /tmp when it exists, so
// the whole test can run even without sharp installed; otherwise it builds
// one from the bundled photo.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { POW_BITS, powChallenge, sha256Hex, solvePow } from '../src/lib/pow.js'

let w, h, rgb
if (existsSync('/tmp/payload_rgb.bin') && existsSync('/tmp/payload_meta.json')) {
  ;({ w, h } = JSON.parse(readFileSync('/tmp/payload_meta.json', 'utf8')))
  rgb = new Uint8Array(readFileSync('/tmp/payload_rgb.bin'))
  console.log('payload: baked /tmp/payload_rgb.bin')
} else {
  const { default: sharp } = await import('sharp')
  const { data: rgba, info } = await sharp('src/assets/pexels-kaplanart-10776642.jpg')
    .resize({ width: 768, height: 768, fit: 'inside', withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  w = info.width
  h = info.height
  rgb = new Uint8Array(w * h * 3)
  for (let i = 0, j = 0; j < rgb.length; i += 4, j += 3) {
    rgb[j] = rgba[i]
    rgb[j + 1] = rgba[i + 1]
    rgb[j + 2] = rgba[i + 2]
  }
  console.log('payload: built from the bundled photo')
}
console.log('payload:', w, 'x', h, '=', rgb.length, 'bytes')

const bucket = Math.floor(Date.now() / 3600000)
const nonce = solvePow(powChallenge(bucket, sha256Hex(rgb)), POW_BITS)
const resp = await fetch('http://localhost:3000/api/depth', {
  method: 'POST',
  headers: {
    origin: 'http://localhost:3000',
    referer: 'http://localhost:3000/',
    'sec-fetch-site': 'same-origin',
    'content-type': 'application/octet-stream',
    'x-parse-w': String(w),
    'x-parse-h': String(h),
    'x-parse-pow': `${bucket}.${nonce}`,
  },
  body: rgb,
})
console.log('status:', resp.status, '| x-depth-w:', resp.headers.get('x-depth-w'), 'x-depth-h:', resp.headers.get('x-depth-h'))
const out = new Uint8Array(await resp.arrayBuffer())
if (resp.status !== 200) {
  console.log('body:', new TextDecoder().decode(out.slice(0, 300)))
  process.exit(1)
}
writeFileSync('/tmp/endpoint_depth.bin', Buffer.from(out))
console.log('depth bytes:', out.length)

if (existsSync('/tmp/direct_depth.bin')) {
  const ref = readFileSync('/tmp/direct_depth.bin')
  let diff = -1
  if (ref.length === out.length) {
    diff = 0
    for (let i = 0; i < ref.length; i++) if (ref[i] !== out[i]) diff++
  }
  console.log('endpoint vs local core: differing bytes:', diff, 'of', ref.length)
}

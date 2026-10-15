// Serverless depth: the deployed site posts a photo here and gets a depth
// map back. The quantized model lives inside this function's bundle, so
// visitors never download it. The browser only falls back to its own copy
// when this endpoint is unreachable.
import path from 'node:path'
import sharp from 'sharp'
import { pipeline, env, RawImage } from '@huggingface/transformers'

env.allowRemoteModels = false
env.allowLocalModels = true
env.localModelPath = path.join(process.cwd(), 'models')
env.cacheDir = '/tmp'

const MODEL_ID = 'onnx-community/depth-anything-v2-small'
const MAX_SIDE = 768

let pipePromise = null

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
  try {
    const body = await readBody(req)
    if (!body.length) {
      res.status(400).json({ error: 'no image in the request' })
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

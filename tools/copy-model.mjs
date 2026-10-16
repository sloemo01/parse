// Ensures public/model.onnx exists: copies the local models/ cache when it
// is present, otherwise downloads the weights from Hugging Face, then
// proves the bytes against a pinned hash. Keeping the weights out of git
// means every deployment's stored source stays tiny; the build rebuilds
// the file instead of the repo carrying it.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

const SRC = 'models/onnx-community/depth-anything-v2-small/onnx/model_quantized.onnx'
const DST = 'public/model.onnx'
const URL = 'https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/main/onnx/model_quantized.onnx'
const SHA = 'fcf51f1b230362b28690bb9d1809bf0431f29cad20534e3f589bd7285547f20d'

const sha = (buf) => createHash('sha256').update(buf).digest('hex')

mkdirSync('public', { recursive: true })
if (existsSync(DST) && sha(readFileSync(DST)) === SHA) {
  console.log('model up to date')
  process.exit(0)
}
if (existsSync(SRC) && sha(readFileSync(SRC)) === SHA) {
  copyFileSync(SRC, DST)
  console.log('model copied from the local cache')
  process.exit(0)
}
const resp = await fetch(URL)
if (!resp.ok) throw new Error(`model download answered ${resp.status}`)
const buf = Buffer.from(await resp.arrayBuffer())
if (sha(buf) !== SHA) throw new Error('model download does not match the pinned hash')
writeFileSync(DST, buf)
console.log('model downloaded from huggingface')

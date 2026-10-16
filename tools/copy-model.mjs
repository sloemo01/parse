// Copies the quantized weights into public/ so every deployment serves them
// as a plain static file. The function then pulls them into /tmp once per
// cold instance, which keeps ~26 MB out of every function bundle while the
// visitor still downloads nothing: the fetch happens server side.
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs'

const SRC = 'models/onnx-community/depth-anything-v2-small/onnx/model_quantized.onnx'
const DST = 'public/model.onnx'

mkdirSync('public', { recursive: true })
if (existsSync(DST) && statSync(DST).size === statSync(SRC).size) {
  console.log('model copy up to date')
} else {
  copyFileSync(SRC, DST)
  console.log('model copied to public/model.onnx')
}

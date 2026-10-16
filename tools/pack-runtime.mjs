// Packs the current platform's onnxruntime package (the engine binary and
// the small JS wrapper around it) into public/ as a brotli tar. On a deploy
// that is linux-x64, so the function can pull it into /tmp per cold instance
// instead of carrying 21 MB in every function bundle. Same idea as the model
// file: heavy bits ride the static side, the visitor still downloads nothing.
//
// The pack stages exactly the files the runtime loads (tar exclude patterns
// turned out unreliable across tar flavours) and drops the duplicate engine
// copy: the binding only ever loads libonnxruntime.so.1.
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { brotliCompressSync, constants } from 'node:zlib'

const platform = `${process.platform}-${process.arch}`
const out = `public/ort-${platform}.tar.br`
const src = 'node_modules/onnxruntime-node'
if (!existsSync(path.join(src, 'package.json'))) {
  console.log('onnxruntime-node not installed, skipping runtime pack')
  process.exit(0)
}

const keep = `${process.platform === 'linux' ? 'linux' : process.platform === 'darwin' ? 'darwin' : 'win32'}/${process.arch}`
const stage = mkdtempSync(path.join(tmpdir(), 'parse-ort-'))
const stageNm = path.join(stage, 'node_modules')

// the wrapper package: manifest, js, and only this platform's native dir
mkdirSync(path.join(stageNm, 'onnxruntime-node'), { recursive: true })
cpSync(path.join(src, 'package.json'), path.join(stageNm, 'onnxruntime-node/package.json'))
cpSync(path.join(src, 'dist'), path.join(stageNm, 'onnxruntime-node/dist'), { recursive: true })
const binSrc = path.join(src, 'bin/napi-v3', keep)
const binDst = path.join(stageNm, 'onnxruntime-node/bin/napi-v3', keep)
mkdirSync(binDst, { recursive: true })
for (const f of readdirSync(binSrc)) {
  if (process.platform === 'linux' && f.startsWith('libonnxruntime.so.1.')) continue
  cpSync(path.join(binSrc, f), path.join(binDst, f))
}

// its runtime dependency
mkdirSync(path.join(stageNm, 'onnxruntime-common'), { recursive: true })
cpSync('node_modules/onnxruntime-common/package.json', path.join(stageNm, 'onnxruntime-common/package.json'))
cpSync('node_modules/onnxruntime-common/dist', path.join(stageNm, 'onnxruntime-common/dist'), { recursive: true })

const tarFile = path.join(stage, 'ort.tar')
const res = spawnSync('tar', ['-cf', tarFile, '-C', stage, 'node_modules'])
if (res.status !== 0) {
  console.error(res.stderr && res.stderr.toString())
  process.exit(1)
}
const tar = readFileSync(tarFile)
const packed = brotliCompressSync(tar, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } })
writeFileSync(out, packed)
rmSync(stage, { recursive: true, force: true })
console.log(`runtime packed: ${out} (${(packed.length / 1e6).toFixed(1)} MB, was ${(tar.length / 1e6).toFixed(1)} MB raw)`)

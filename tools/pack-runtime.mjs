// Packs the current platform's onnxruntime package (the engine binary and
// the small JS wrapper around it) into public/ as a brotli tar. On a deploy
// that is linux-x64, so the function can pull it into /tmp per cold instance
// instead of carrying 21 MB in every function bundle. Same idea as the model
// file: heavy bits ride the static side, the visitor still downloads nothing.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { brotliCompressSync, constants } from 'node:zlib'

const platform = `${process.platform}-${process.arch}`
const out = `public/ort-${platform}.tar.br`
const src = 'node_modules/onnxruntime-node'
const pkgJson = path.join(src, 'package.json')
if (!existsSync(pkgJson)) {
  console.log('onnxruntime-node not installed, skipping runtime pack')
  process.exit(0)
}

// keep only this platform and architecture of the native binaries
const keep = process.platform === 'linux' ? `linux/${process.arch}` : `${process.platform === 'darwin' ? 'darwin' : 'win32'}/${process.arch}`
const excludes = []
for (const p of ['darwin', 'win32', 'linux']) {
  if (process.platform === p) {
    for (const a of ['x64', 'arm64']) {
      if (`${p}/${a}` !== keep) excludes.push(`--exclude=node_modules/onnxruntime-node/bin/napi-v3/${p}/${a}`)
    }
  } else {
    excludes.push(`--exclude=node_modules/onnxruntime-node/bin/napi-v3/${p}`)
  }
}

const stage = mkdtempSync(path.join(tmpdir(), 'parse-ort-'))
const tarFile = path.join(stage, 'ort.tar')
const res = spawnSync('tar', ['-cf', tarFile, ...excludes, 'node_modules/onnxruntime-node', 'node_modules/onnxruntime-common'])
if (res.status !== 0) {
  console.error(res.stderr && res.stderr.toString())
  process.exit(1)
}
const tar = readFileSync(tarFile)
const packed = brotliCompressSync(tar, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } })
writeFileSync(out, packed)
rmSync(stage, { recursive: true, force: true })
console.log(`runtime packed: ${out} (${(packed.length / 1e6).toFixed(1)} MB, was ${(tar.length / 1e6).toFixed(1)} MB raw)`)

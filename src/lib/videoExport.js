// Quality video export through WebCodecs when the browser has it. Frames are
// rendered on a fixed clock (not in real time) and encoded in quality mode,
// then muxed into an mp4. Returns null when WebCodecs or every codec in the
// ladder is missing, so the caller can fall back to MediaRecorder.
import { ArrayBufferTarget, Muxer } from 'mp4-muxer'

const CODECS = ['avc1.640033', 'avc1.4d0032', 'avc1.42001f']

export async function encodeWebCodecs({ canvas, width, height, fps, frameCount, drawFrame }) {
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') return null

  let config = null
  for (const codec of CODECS) {
    const candidate = {
      codec,
      width,
      height,
      bitrate: 40000000,
      framerate: fps,
      latencyMode: 'quality',
    }
    try {
      const support = await VideoEncoder.isConfigSupported(candidate)
      if (support && support.supported) {
        config = candidate
        break
      }
    } catch (err) {
      // try the next codec string
    }
  }
  if (!config) return null

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: 'avc', width, height },
    fastStart: 'in-memory',
  })

  let failure = null
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (err) => {
      failure = err
    },
  })
  encoder.configure(config)

  for (let i = 0; i < frameCount; i++) {
    if (failure) throw failure
    drawFrame(i / fps)
    const frame = new VideoFrame(canvas, {
      timestamp: Math.round((i * 1000000) / fps),
      duration: Math.round(1000000 / fps),
    })
    encoder.encode(frame, { keyFrame: i % 60 === 0 })
    frame.close()
    while (encoder.encodeQueueSize > 8 && !failure) {
      await new Promise((resolve) => setTimeout(resolve, 4))
    }
    if (i % 12 === 0) {
      // let the page breathe while the offline encode runs
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  }

  await encoder.flush()
  encoder.close()
  if (failure) throw failure
  muxer.finalize()
  return new Blob([muxer.target.buffer], { type: 'video/mp4' })
}

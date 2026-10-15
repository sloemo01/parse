import { VERT, FRAG } from './shaders.js'

const UNIFORM_NAMES = [
  'uImage', 'uDepth', 'uDepthSoft', 'uLut', 'uAspect', 'uDirX', 'uDirY', 'uRadial',
  'uInvert', 'uDepthMix', 'uPhoto', 'uRoll', 'uRepeat', 'uWrap', 'uOffset', 'uSteps', 'uBlend', 'uViewDepth',
  'uOriginal', 'uWipe', 'uWipeDepth', 'uSoft', 'uSweepBlur',
  'uDither', 'uDitherSize', 'uDitherStyle',
]

function compileShader(gl, type, source) {
  const shader = gl.createShader(type)
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader)
    gl.deleteShader(shader)
    throw new Error(`Shader compile failed: ${log}`)
  }
  return shader
}

function makeTexture(gl, unit) {
  const tex = gl.createTexture()
  gl.activeTexture(gl.TEXTURE0 + unit)
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  return tex
}

export function createRenderer(canvas) {
  const gl = canvas.getContext('webgl', {
    alpha: false,
    antialias: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: true,
  })
  if (!gl) throw new Error('WebGL is not available here')

  const program = gl.createProgram()
  gl.attachShader(program, compileShader(gl, gl.VERTEX_SHADER, VERT))
  gl.attachShader(program, compileShader(gl, gl.FRAGMENT_SHADER, FRAG))
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`Shader link failed: ${gl.getProgramInfoLog(program)}`)
  }

  // One oversized triangle covers the viewport.
  const buffer = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
  const aPos = gl.getAttribLocation(program, 'aPos')
  gl.enableVertexAttribArray(aPos)
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)

  gl.useProgram(program)
  const U = {}
  for (const name of UNIFORM_NAMES) U[name] = gl.getUniformLocation(program, name)

  gl.uniform1i(U.uImage, 0)
  gl.uniform1i(U.uDepth, 1)
  gl.uniform1i(U.uLut, 2)
  gl.uniform1i(U.uDepthSoft, 3)

  const imageTex = makeTexture(gl, 0)
  const depthTex = makeTexture(gl, 1)
  const lutTex = makeTexture(gl, 2)
  const depthSoftTex = makeTexture(gl, 3)

  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)

  let imageW = 1
  let imageH = 1

  function upload(unit, tex, source, w, h) {
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, tex)
    if (w) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, source)
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)
  }

  function draw(state, bufW, bufH) {
    if (canvas.width !== bufW || canvas.height !== bufH) {
      canvas.width = bufW
      canvas.height = bufH
    }
    gl.viewport(0, 0, canvas.width, canvas.height)
    gl.useProgram(program)
    gl.uniform1f(U.uAspect, imageW / imageH)
    gl.uniform1f(U.uDirX, state.dirX)
    gl.uniform1f(U.uDirY, state.dirY)
    gl.uniform1f(U.uRadial, state.radial)
    gl.uniform1f(U.uInvert, state.invert)
    gl.uniform1f(U.uDepthMix, state.depthMix)
    gl.uniform1f(U.uPhoto, state.photo)
    gl.uniform1f(U.uRoll, state.roll)
    gl.uniform1f(U.uRepeat, state.repeat)
    gl.uniform1f(U.uWrap, state.wrap)
    gl.uniform1f(U.uOffset, state.offset)
    gl.uniform1f(U.uSteps, state.steps)
    gl.uniform1f(U.uBlend, state.blend)
    gl.uniform1f(U.uViewDepth, state.viewDepth)
    gl.uniform1f(U.uOriginal, state.original)
    gl.uniform1f(U.uWipe, state.wipe)
    gl.uniform1f(U.uWipeDepth, state.wipeDepth)
    gl.uniform1f(U.uSoft, state.soft)
    gl.uniform1f(U.uSweepBlur, state.sweepBlur)
    gl.uniform1f(U.uDither, state.dither)
    // Cell size is set at photo scale, so the pattern reads the same on
    // screen and in a full size export.
    gl.uniform1f(U.uDitherSize, Math.max(0.5, state.ditherSize * (canvas.height / imageH)))
    gl.uniform1f(U.uDitherStyle, state.ditherStyle)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  return {
    // The uploaded photo is capped to this so any size fits as a texture.
    maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
    setImage(source) {
      imageW = source.naturalWidth || source.width
      imageH = source.naturalHeight || source.height
      upload(0, imageTex, source)
    },
    setDepth(source) {
      upload(1, depthTex, source)
    },
    setDepthSoft(source) {
      upload(3, depthSoftTex, source)
    },
    setLut(data) {
      upload(2, lutTex, data, 256, 1)
    },
    render(state, bufW, bufH) {
      draw(state, bufW, bufH)
    },
    // Draw at export resolution, hand back a function that fits the canvas
    // back to its display size.
    beginExport(state, w, h) {
      const prevW = canvas.width
      const prevH = canvas.height
      draw(state, w, h)
      return () => draw(state, prevW, prevH)
    },
  }
}

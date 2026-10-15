// Colorama style output cycles. Palettes marked loop start and end on the same
// stop so the ramp can wrap without a seam.

export const PALETTES = [
  { id: 'colorama', name: 'colorama', loop: true, stops: ['#1414ff', '#00e5ff', '#00e05a', '#f2f000', '#ff2d00', '#ff00c8', '#1414ff'] },
  { id: 'spectrum', name: 'spectrum', loop: true, stops: ['#ff2d55', '#ff9500', '#ffd60a', '#34c759', '#00c7be', '#0a84ff', '#5e5ce6', '#ff2d55'] },
  { id: 'sunset', name: 'sunset', stops: ['#160f33', '#4b1d5e', '#a1285c', '#e04f3f', '#f79a4d', '#ffd98e'] },
  { id: 'ice', name: 'ice', stops: ['#04122e', '#0a4a7a', '#2496b8', '#93dbe0', '#f2fbff'] },
  { id: 'neon', name: 'neon', loop: true, stops: ['#0d0021', '#7a00ff', '#ff2bd6', '#00e5ff', '#0d0021'] },
  { id: 'ember', name: 'ember', stops: ['#0a0503', '#5c1400', '#d14300', '#ff9a1f', '#ffd166', '#fff3d0'] },
  { id: 'citrus', name: 'citrus', stops: ['#06280f', '#3f8f1f', '#b3dc26', '#ffe24d', '#ff9f43'] },
  { id: 'candy', name: 'candy', stops: ['#2a0733', '#7a1d8f', '#e0449c', '#ff9e7d', '#ffe3a3'] },
  { id: 'steel', name: 'steel', stops: ['#05070d', '#1d2635', '#4a5a75', '#93a6c4', '#e8eef7'] },
  { id: 'noir', name: 'noir', stops: ['#000000', '#ffffff'] },
]

export function hexToRgb(hex) {
  const h = hex.replace('#', '')
  const v = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16)
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
}

function rgbToHsl(r, g, b) {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  let h = 0
  let s = 0
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
    else if (max === g) h = ((b - r) / d + 2) / 6
    else h = ((r - g) / d + 4) / 6
  }
  return [h, s, l]
}

function hue2rgb(p, q, t) {
  if (t < 0) t += 1
  if (t > 1) t -= 1
  if (t < 1 / 6) return p + (q - p) * 6 * t
  if (t < 1 / 2) return q
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
  return p
}

function hslToRgb(h, s, l) {
  if (s === 0) return [l, l, l]
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  return [hue2rgb(p, q, h + 1 / 3), hue2rgb(p, q, h), hue2rgb(p, q, h - 1 / 3)]
}

// Bake a palette to a 256 x 1 RGBA lookup table for the shader. hueShift is in
// turns (1 = full circle).
export function buildLut(palette, size = 256, hueShift = 0) {
  const stops = palette.stops.map(hexToRgb)
  const segs = stops.length - 1
  const out = new Uint8Array(size * 4)
  for (let i = 0; i < size; i++) {
    const t = i / (size - 1)
    const s = Math.min(segs - 1, Math.floor(t * segs))
    const f = t * segs - s
    const a = stops[s]
    const b = stops[s + 1]
    let r = (a[0] + (b[0] - a[0]) * f) / 255
    let g = (a[1] + (b[1] - a[1]) * f) / 255
    let bl = (a[2] + (b[2] - a[2]) * f) / 255
    if (hueShift) {
      const [hh, ss, ll] = rgbToHsl(r, g, bl)
      const rgb = hslToRgb((hh + hueShift + 1) % 1, ss, ll)
      r = rgb[0]
      g = rgb[1]
      bl = rgb[2]
    }
    const o = i * 4
    out[o] = Math.round(r * 255)
    out[o + 1] = Math.round(g * 255)
    out[o + 2] = Math.round(bl * 255)
    out[o + 3] = 255
  }
  return out
}

export function paletteCss(palette, hueShift = 0) {
  const n = 7
  const lut = buildLut(palette, 64, hueShift)
  const stops = []
  for (let i = 0; i < n; i++) {
    const idx = Math.round((i / (n - 1)) * 63)
    stops.push(`rgb(${lut[idx * 4]}, ${lut[idx * 4 + 1]}, ${lut[idx * 4 + 2]})`)
  }
  return `linear-gradient(90deg, ${stops.join(', ')})`
}

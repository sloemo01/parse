export const VERT = `
attribute vec2 aPos;
varying vec2 vUv;

void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`

export const FRAG = `
precision highp float;

varying vec2 vUv;

uniform sampler2D uImage;
uniform sampler2D uDepth;
uniform sampler2D uDepthSoft;
uniform sampler2D uLut;

uniform float uAspect;
uniform float uDirX;
uniform float uDirY;
uniform float uRadial;
uniform float uInvert;
uniform float uDepthMix;
uniform float uPhoto;
uniform float uCombine;
uniform float uRoll;
uniform float uTravel;
uniform float uTravelOn;
uniform float uRepeat;
uniform float uWrap;
uniform float uOffset;
uniform float uSteps;
uniform float uBlend;
uniform float uViewDepth;
uniform float uOriginal;
uniform float uWipe;
uniform float uWipeDepth;
uniform float uSoft;
uniform float uSweepBlur;
uniform float uDither;
uniform float uDitherSize;
uniform float uDitherStyle;

// Ordered dithering. The 2x2 bayer cell grows into 4x4 and 8x8 by recursion;
// the hashed variant reads as plain grain. Both return roughly 0..1.
float bayer2(vec2 a) {
  a = floor(a);
  return fract(a.x * 0.5 + a.y * a.y * 0.75);
}

float bayer8(vec2 a) {
  float b4 = bayer2(a * 0.25) * 0.25 + bayer2(a * 0.5);
  return b4 * 0.25 + bayer2(a);
}

float hashNoise(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

void main() {
  vec2 uv = vUv;

  // Sources. The sweep blur peaks halfway through the transition and cleans
  // up at both ends, like the animated box blur in the reference. It is a
  // straight-line input blur: no branches, no function calls, so every
  // backend compiles it the same way.
  float w = uSweepBlur * sin(3.14159265 * clamp(uWipe, 0.0, 1.0));
  float r = 0.014;
  vec3 img = texture2D(uImage, uv).rgb;
  float depth = texture2D(uDepth, uv).r;
  // The wipe reads a heavily smoothed depth so the reveal front sweeps the
  // whole scene consistently instead of wrapping around small objects.
  float depthSoft = texture2D(uDepthSoft, uv).r;
  vec3 imgBlur = img;
  float depthBlur = depth;
  imgBlur += texture2D(uImage, vec2(uv.x + r, uv.y)).rgb;
  depthBlur += texture2D(uDepth, vec2(uv.x + r, uv.y)).r;
  imgBlur += texture2D(uImage, vec2(uv.x - r, uv.y)).rgb;
  depthBlur += texture2D(uDepth, vec2(uv.x - r, uv.y)).r;
  imgBlur += texture2D(uImage, vec2(uv.x, uv.y + r)).rgb;
  depthBlur += texture2D(uDepth, vec2(uv.x, uv.y + r)).r;
  imgBlur += texture2D(uImage, vec2(uv.x, uv.y - r)).rgb;
  depthBlur += texture2D(uDepth, vec2(uv.x, uv.y - r)).r;
  img = mix(img, imgBlur * 0.2, w);
  depth = mix(depth, depthBlur * 0.2, w);

  float t;
  if (uRadial > 0.5) {
    vec2 p = (uv - 0.5) * vec2(uAspect, 1.0);
    t = length(p) * 2.0;
  } else {
    vec2 d = normalize(vec2(uDirX, uDirY) + vec2(1e-6));
    float ext = abs(d.x) + abs(d.y);
    t = dot(uv - 0.5, d) / ext + 0.5;
  }
  t = clamp(t, 0.0, 1.0);

  // The ramp input: position along the direction, the depth map, or the
  // photo's own tones (a gradient map, the way colorama reads the image).
  float v = mix(t, depth, uDepthMix);
  float lum = dot(img, vec3(0.2126, 0.7152, 0.0722));
  // Photo tones read the ramp from the image itself. The combine mode blends
  // those tones with the depth map instead of letting the tones override
  // everything, at the depth mix amount.
  float photoV = mix(lum, depth, uDepthMix * uCombine);
  v = mix(v, photoV, uPhoto);
  v = mix(v, 1.0 - v, uInvert);

  v = v * uRepeat + uOffset;
  v = mix(clamp(v, 0.0, 1.0), fract(v), uWrap);

  // Rolling colors advance the ramp through the palette cycle. The roll
  // always wraps, so a finished sweep can never leave the ramp saturated
  // into a flat color. While animate runs in photo tones mode the motion
  // turns into a wave: the tones still anchor every pixel, and the colour
  // pattern itself slides across the frame in the chosen direction. The
  // image never moves; only the palette does.
  float flow = uTravelOn * uPhoto * (t - uTravel);
  float cycle = (1.0 - uTravelOn * uPhoto) * uRoll;
  v = fract(v + flow + cycle);

  // Dither nudges the ramp by a bayer or noise pattern just before the
  // posterize step, so band edges break up into ordered dots. uDither is
  // the strength; zero switches the whole thing off.
  vec2 ditherCell = gl_FragCoord.xy / max(uDitherSize, 0.5);
  float ditherPattern = mix(bayer8(ditherCell), hashNoise(floor(ditherCell)), uDitherStyle);
  v += (ditherPattern - 0.5) * uDither;

  if (uSteps > 1.5) {
    float q = floor(min(v, 0.999999) * uSteps);
    v = q / (uSteps - 1.0);
  }

  vec3 mapped = texture2D(uLut, vec2(clamp(v, 0.0, 1.0), 0.5)).rgb;
  vec3 result = mix(img, mapped, uBlend);
  result = mix(result, vec3(depth), uViewDepth);

  // Reveal, the gradient wipe: the front travels through the wipe field,
  // the depth map by default (foreground first, then the rest of the scene
  // by depth) or through the directional field. The original comes up
  // underneath. The front runs a hair past both ends so the extremes clean
  // up fully.
  float field = mix(t, depthSoft, uWipeDepth);
  field = mix(field, 1.0 - field, uInvert);
  float front = uWipe * (1.0 + 2.0 * uSoft) - uSoft;
  float reveal = 1.0 - smoothstep(front - uSoft, front + uSoft, field);

  result = mix(result, img, max(uOriginal, reveal));

  gl_FragColor = vec4(result, 1.0);
}
`

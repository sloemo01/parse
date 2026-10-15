# parse

A React + WebGL shader that recolors a photo with an After Effects Colorama style cycle, then wipes it away with a gradient transition that reveals the original underneath. The transition is modelled on the SaaS gradient transition tutorial (sheikh sohel on YouTube): a Colorama style colorized layer, a gradient wipe driven by a real depth map, and a soft animated blur that rides the transition.

## run

    npm install
    npm run dev        # localhost:5173
    npm run depth      # regenerate the depth map (first run downloads the model)
    npm run build      # single file bundle in dist/index.html

## controls

- direction: eight ramp axes plus a radial mode. invert flips the ramp and the reveal order.
- depth mix: 0 keeps the ramp positional, 1 reads it entirely from the depth map. photo tones reads the ramp from the photo itself instead, the way colorama does in the tutorial.
- reveal: the gradient wipe. the front runs through the chosen direction by default, blooming out of the middle on the center dot, revealing the original underneath; slide wipe source toward the depth map for a wipe that follows the scene's depth instead. play runs the sweep, the slider scrubs it.
- softness: how wide the transition edge is. sweep blur: a gentle blur that peaks halfway and cleans up at both ends, like the animated box blur in the tutorial. roll colors cycles the palette while the sweep runs.
- ramp: cycles, phase, posterize steps, and a loop toggle that wraps the ramp.
- dither: patterns the ramp just before the posterize step, so stacked colors break into ordered dots. bayer or noise, with amount and cell size. switching it on raises steps to 8 for the classic look.
- palette: ten cycles with a hue shift on top. colorama is the default.
- motion: scrolls the ramp over time.
- holding the photo or the pill under it shows the untouched original for as long as you hold.
- open photo: loads any image at any size, or drop one straight on the canvas. oversized photos are scaled down to the gpu texture limit; a dropped photo gets its depth map estimated in the browser.
- export png renders at the photo's full size. save map writes the grayscale texture the shader feeds on.
- export video records the sweep as a webm (up to 1920px on the long side). the browser's own recorder captures the canvas in real time, so the clip takes about 3 seconds to render and shows the animation plus a short hold on the revealed photo.

## the depth map

src/assets/depth.png is a real monocular depth estimate of the photo, produced offline by Depth Anything V2 (large) through transformers.js, with the photo's own high-frequency texture blended back in so fine detail like water ripples survives. A second, heavily smoothed copy (depth-soft.png) drives the reveal wipe, so the front sweeps the whole scene consistently:

    npm run depth

The script runs the model over the photo, stretches the contrast, and writes a grayscale PNG that the app bundles. The same model family also runs live in the browser (Depth Anything V2 small through transformers.js, WebGPU first with a wasm fallback, weights cached after the first run): photos you open or drop get refined by it automatically, and the ai depth button runs it on whatever is loaded. The shader only reads a grayscale texture, so any depth estimate drops in the same way.

## deploy

The repo is private on GitHub and deploys to Vercel as a static Vite site. Everything runs client side: no servers, no functions, and the depth model only downloads when someone actually asks for it.

## notes

- The built file accepts query params for deep linking a state, for example ?wipe=0.5&wipesource=0&palette=neon
- The bundled photo is resized to 1600 x 2400 to keep the single file build light. Replace the file in src/assets and the shader picks up the new size on its own.
- photo: Kaplan Art on Pexels.

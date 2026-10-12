# Flipibook BG Remover

A React + Vite background-removal tool. It accepts JPG/JPEG, PNG, and WebP images up to 30 MB. Image segmentation runs locally in the browser with IMG.LY's `@imgly/background-removal` package and ONNX Runtime Web. The image is never sent to an inference API or backend.

## Run locally

```bash
npm install
npm run dev
```

Then open the Vite URL shown in the terminal. To create and serve a production build:

```bash
npm run build
npm run preview
```

Run the alpha-mask regression checks with `npm test`.

## Local AI assets and privacy

This project includes IMG.LY's higher-quality `isnet_fp16` model and the CPU/WASM runtime under `public/background-removal-data/` (about 95 MiB / 100 MB total). The AI engine is lazy-loaded on the first processing run; the image itself remains in the browser and is not uploaded. No external model/CDN request is needed at runtime.

If you remove those binary assets, restore them with:

```bash
npm run assets:sync
```

That one-time setup command fetches the pinned IMG.LY 1.7.0 data assets. It is not needed at runtime when the included files are present.

For lower-memory computers, **Fast** is selected by default and scales large inputs to a 1,280 px long edge before processing. **Full** allows up to 2,048 px. In non-cross-origin-isolated contexts, the app limits the runtime to one WASM thread for compatibility; isolated deployments can use multiple cores.

`npm run assets:sync` also applies a small, fail-fast patch to the pinned IMG.LY 1.7.0 converter: it clamps non-finite/out-of-range scores but keeps every representable soft alpha value—there is no extra confidence cutoff that could erase fine lettering. When most border samples are neutral near-white, a local contrast pass recovers model-missed lettering/details and decontaminates recoverable antialiased edges. Both steps run in the browser; the white-background pass is skipped for other backgrounds. The vendor patch stops with an error if the installed package version or converter changes, so an upstream update cannot silently bypass the fix.

## Canvas tools

Zoom with the canvas **+ / −** controls or Ctrl/⌘ + wheel; choose **Pan** to drag around while zoomed, and **Fit** to reset. The touch-up editor includes **Erase** and **Restore** brushes: Restore paints pixels from the original photo, including any background under the brush. Undo reverses the last brush stroke; Reset clears all touch-ups.

## Cross-origin isolation

The Vite dev and preview servers send `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` to allow WebAssembly threading where the browser/runtime supports it. Production hosting should send the same headers for comparable performance. If your deployment environment cannot enable these headers, the app falls back to one WASM thread.

## Stack

- React 19 + Vite 7
- `@imgly/background-removal` with `onnxruntime-web`
- Plain CSS; no UI framework, font CDN, image CDN, inference API, or backend

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const isolationHeaders = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

export default defineConfig({
  plugins: [react()],
  resolve: {
    // This UI deliberately uses the CPU/WASM path, so do not ship ONNX Runtime's unused WebGPU JSEP bundle.
    alias: [
      { find: /^onnxruntime-web\/webgpu$/, replacement: "onnxruntime-web/wasm" },
      { find: /^onnxruntime-web$/, replacement: "onnxruntime-web/wasm" },
    ],
  },
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
    headers: isolationHeaders,
  },
  preview: {
    host: "0.0.0.0",
    allowedHosts: true,
    headers: isolationHeaders,
  },
});

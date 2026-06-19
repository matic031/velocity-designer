import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Standalone frontend-only tool. No proxy, no SSR, just a design surface
// for composing X / LinkedIn social cards, deployed to GitHub Pages.
//
// `base` MUST match the repo name because GitHub Pages serves project sites
// from https://<user>.github.io/<repo>/. If you rename the repo, update this.
export default defineConfig({
  base: "/velocity-designer/",
  plugins: [react()],
  server: {
    port: 5180,
    strictPort: false,
    open: true,
  },
  build: {
    outDir: "dist",
    sourcemap: false,
  },
});

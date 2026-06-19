import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { PasswordGate } from "./PasswordGate";
import "./index.css";

/**
 * Force `preserveDrawingBuffer: true` on every WebGL context the page
 * creates. The reactbits backgrounds use Three.js / R3F / OGL, all of
 * which default to `preserveDrawingBuffer: false` (faster compositor
 * path). That default breaks the PNG export: html-to-image grabs each
 * <canvas> via `toDataURL()`, but a WebGL canvas without preserved
 * drawing buffer returns transparent pixels the moment the back buffer
 * is composited. Result: the export looks fine on screen but ships a
 * card with no animated background.
 *
 * Monkey-patching the prototype is the only way to flip the flag
 * uniformly across libraries we don't directly own. Cost is a tiny
 * extra GPU memory copy per frame — invisible at editor scale.
 */
(() => {
  type GetCtx = typeof HTMLCanvasElement.prototype.getContext;
  const original: GetCtx = HTMLCanvasElement.prototype.getContext;
  const patched: GetCtx = function patchedGetContext(
    this: HTMLCanvasElement,
    ...args: Parameters<GetCtx>
  ): ReturnType<GetCtx> {
    const [type, attrs] = args;
    if (type === "webgl" || type === "webgl2" || type === "experimental-webgl") {
      const merged = {
        ...((attrs as WebGLContextAttributes | undefined) ?? {}),
        preserveDrawingBuffer: true,
      };
      return (original as (
        this: HTMLCanvasElement,
        t: string,
        a?: WebGLContextAttributes,
      ) => ReturnType<GetCtx>).call(this, type, merged);
    }
    return original.apply(this, args);
  } as GetCtx;
  HTMLCanvasElement.prototype.getContext = patched;
})();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <PasswordGate>
      <App />
    </PasswordGate>
  </React.StrictMode>,
);

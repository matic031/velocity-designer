/**
 * Resolve a public-folder asset path against Vite's base URL.
 *
 * Vite only rewrites asset URLs that pass through the bundler (ES imports and
 * index.html). Runtime string paths - an <img src>, a layer's stored src -
 * are NOT rewritten, so a root-absolute "/tier/x.png" 404s when the app is
 * served from a sub-path. GitHub Pages serves this app from
 * https://<user>.github.io/velocity-designer/, so every public asset must be
 * prefixed with import.meta.env.BASE_URL (which is "/" locally and
 * "/velocity-designer/" on Pages).
 *
 * Pass a path with or without a leading slash.
 */
export function assetUrl(path: string): string {
  const base = import.meta.env.BASE_URL; // always ends with "/"
  return `${base}${path.replace(/^\/+/, "")}`;
}

/**
 * Repair an image layer's stored `src` loaded from a design saved before the
 * base-path fix. Root-absolute public assets ("/tier/...", "/social/...") get
 * re-prefixed with the current base; data:/http(s)/relative URLs and paths
 * already under the base are left untouched (so re-saving never double-prefixes).
 */
export function healAssetSrc(src: string): string {
  if (!src.startsWith("/")) return src; // data:, http(s):, or relative
  const base = import.meta.env.BASE_URL;
  if (base !== "/" && src.startsWith(base)) return src; // already correct
  if (/^\/(tier|social)\//.test(src)) {
    return `${base}${src.replace(/^\/+/, "")}`;
  }
  return src;
}

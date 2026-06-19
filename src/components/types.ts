/**
 * Type model for the /social social-card editor.
 *
 * Every layer position + size is stored as a fraction of the canvas (0..1)
 * so a design composes identically across X (1200x675) and LinkedIn
 * (1200x627) without per-format recomputation. The render layer multiplies
 * fractions by the active format's pixel dimensions at draw time.
 */

export type Format = "x" | "linkedin";

export type Font = "sans" | "brand";

export type LayerAlign = "left" | "center" | "right";

export type LayerWeight = 300 | 400 | 500 | 600 | 700;

export interface BaseLayer {
  id: string;
  /** anchor X as fraction of canvas width (layers are centred on this point). */
  x: number;
  /** anchor Y as fraction of canvas height. */
  y: number;
  opacity: number;
  /** degrees, clockwise. */
  rotation: number;
}

export interface TextLayer extends BaseLayer {
  type: "text";
  text: string;
  font: Font;
  /** as fraction of canvas height. */
  size: number;
  weight: LayerWeight;
  /** em. */
  tracking: number;
  lineHeight: number;
  color: string;
  uppercase: boolean;
  align: LayerAlign;
  /** soft drop-shadow so eyebrow / overlay text lifts off busy backgrounds. */
  shadow: boolean;
  /** glow halo color, e.g. "rgba(47,123,255,0.55)". null = no glow. */
  glow: string | null;
}

export interface ImageLayer extends BaseLayer {
  type: "image";
  /** /public path or data: URL (file uploads). */
  src: string;
  /** as fraction of canvas width. */
  width: number;
  /** as fraction of canvas height. 0 = square (auto from width). */
  height: number;
  /** raw CSS filter string, e.g. "saturate(1.4) brightness(0.9) drop-shadow(...)". */
  filter: string;
  /** 0..1 feather depth for radial edge mask (0 = no mask, 0.4 = aggressive). */
  featherRadius: number;
}

export interface LineLayer extends BaseLayer {
  type: "line";
  orientation: "vertical" | "horizontal";
  /** length as fraction of the matching canvas axis. */
  length: number;
  /** thickness in pixels. */
  thickness: number;
  color: string;
  /** gradient fade at both ends instead of a hard hairline. */
  fade: boolean;
}

export type Layer = TextLayer | ImageLayer | LineLayer;

export interface GradientParams {
  /** radial = soft centred bloom; linear = directional sweep. */
  type: "radial" | "linear";
  /** linear angle in degrees, 0 = bottom→top, 90 = left→right. Ignored
   *  when type=radial. */
  angle: number;
  /** 0..1 — how far the gradient bloom extends across the frame. For
   *  radial it's the ellipse radius (30..120% of the canvas); for
   *  linear it stretches the colour-stop spread either side of centre. */
  spread: number;
  /** 0..1 — fractal-noise grain overlay strength. 0 = clean gradient,
   *  1 = heavy texture. Privy-style decks typically sit around 0.2. */
  grain: number;
}

export const DEFAULT_GRADIENT_PARAMS: GradientParams = {
  type: "radial",
  angle: 180,
  spread: 0.7,
  grain: 0.2,
};

export interface CanvasState {
  format: Format;
  backgroundId: string;
  /** Per-design colour override for the active background. null = use
   *  the background's defaultColors (the Velocity-blue gradient). The
   *  array length must match the background's defaultColors length;
   *  switching backgrounds resets this to null. */
  backgroundColors: string[] | null;
  /** 0..1 multiplier applied to the rendered background. 1 = full
   *  intensity (default), 0.4 = dimmed for a quieter base, 0 = effectively
   *  hidden (the card sits on the solid black floor). */
  backgroundOpacity: number;
  /** Tunable knobs for the "Custom Gradient" background. Stored on
   *  every state regardless of active background so flipping back to
   *  the custom gradient preserves the user's last tweak. */
  gradientParams: GradientParams;
  layers: Layer[];
  selectedLayerId: string | null;
}

export const FORMAT_DIMS: Record<Format, { width: number; height: number; label: string }> = {
  x: { width: 1200, height: 675, label: "X · 16:9" },
  linkedin: { width: 1200, height: 627, label: "LinkedIn · 1.91:1" },
};

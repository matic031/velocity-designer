/**
 * Shared, lockable focus point for mouse-driven backgrounds.
 *
 * The social editor lets the user aim the mouse-reactive backgrounds at a
 * fixed spot and "lock" it, so a still PNG export captures the effect at a
 * chosen position instead of wherever the cursor happened to be. Rather than
 * thread a fast-changing value through React (which would re-mount the WebGL
 * backgrounds on every move and cause a flash), the editor writes the
 * normalized point here and each background reads it inside its own animation
 * loop.
 *
 * Coordinates are normalized 0..1 with a TOP-LEFT origin (matching CSS and the
 * canvas bounding box). Each background converts to its own internal
 * convention - some flip Y to a bottom-left origin, some use a centered
 * -1..1 range, some use device-pixel buffer coordinates.
 *
 * Only backgrounds whose effect depends on cursor POSITION read this. Motion
 * driven backgrounds (Dot Field, Dot Grid - their effect comes from cursor
 * speed) ignore it, since a frozen point produces no motion.
 */
export interface MouseFocus {
  /** 0 = left edge, 1 = right edge. */
  x: number;
  /** 0 = top edge, 1 = bottom edge. */
  y: number;
}

export const mouseFocus: MouseFocus = { x: 0.5, y: 0.5 };

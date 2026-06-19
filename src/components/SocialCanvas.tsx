"use client";

/**
 * Pure render layer for the /social editor. Given a CanvasState + a target
 * pixel size, draws the background and layers in document order. Owns
 * nothing — drag state, selection, and export all live in the parent
 * editor so this component can also drive the export snapshot cleanly.
 */

import { memo, useMemo } from "react";
import { BACKGROUND_BY_ID, resolveBackgroundColors, type Background } from "./backgrounds";
import type { CanvasState, GradientParams, ImageLayer, Layer, LineLayer, TextLayer } from "./types";

interface Props {
  state: CanvasState;
  width: number;
  height: number;
  /** when true, draw the selection ring around the selected layer. Off
   *  during PNG export so the marker doesn't bake into the output. */
  showSelection: boolean;
  /** which axes the currently-dragged layer is snapped to. Drives the
   *  centreline guides; both false = no guides shown. */
  snapAxes?: { x: boolean; y: boolean };
  onLayerPointerDown?: (id: string, e: React.PointerEvent) => void;
  /** Fired when the user grabs one of the corner resize handles. The
   *  editor uses this to enter a resize-drag (uniform scale around the
   *  layer's centre) instead of a translate. */
  onLayerResizePointerDown?: (id: string, e: React.PointerEvent) => void;
  onBackgroundPointerDown?: (e: React.PointerEvent) => void;
}

/**
 * Background subtree extracted + memoised. Layer drags fire dispatches at
 * ~120Hz, which forces SocialCanvas to re-render constantly. Without this
 * memo the background's React element re-mounts (or the reactbits
 * useEffect deps re-fire) and the WebGL renderer re-initialises every
 * tick, which is exactly the flash the user sees. Memo deps are the bg
 * id + the resolved colours (themselves memo'd in the parent), so the
 * background re-renders only when those actually change.
 */
const MemoBackground = memo(function MemoBackground({
  bg,
  width,
  height,
  colors,
  gradientParams,
}: {
  bg: Background | undefined;
  width: number;
  height: number;
  colors: string[];
  gradientParams: GradientParams;
}): React.JSX.Element | null {
  if (!bg) return null;
  const BgRender = bg.render;
  return (
    <BgRender
      width={width}
      height={height}
      colors={colors}
      gradientParams={gradientParams}
      interactive
    />
  );
}, (prev, next) => {
  // Custom comparator: bg by reference (registry is stable), colors by
  // element-wise equality (so user colour edits trigger a re-render but
  // a new array with identical contents doesn't), gradientParams by
  // field-wise equality so the custom-gradient knobs apply instantly
  // without re-mounting other backgrounds that ignore the prop. Opacity
  // is applied outside the memo (wrapping div) so it never reaches here.
  if (prev.bg !== next.bg) return false;
  if (prev.width !== next.width || prev.height !== next.height) return false;
  if (prev.colors.length !== next.colors.length) return false;
  for (let i = 0; i < prev.colors.length; i++) {
    if (prev.colors[i] !== next.colors[i]) return false;
  }
  const pg = prev.gradientParams;
  const ng = next.gradientParams;
  if (pg.type !== ng.type) return false;
  if (pg.angle !== ng.angle) return false;
  if (pg.spread !== ng.spread) return false;
  if (pg.grain !== ng.grain) return false;
  return true;
});

export function SocialCanvas({
  state,
  width,
  height,
  showSelection,
  snapAxes,
  onLayerPointerDown,
  onLayerResizePointerDown,
  onBackgroundPointerDown,
}: Props): React.JSX.Element {
  const bg = BACKGROUND_BY_ID[state.backgroundId] ?? BACKGROUND_BY_ID.black;
  // Resolved colours memoised against the backgroundId + override so the
  // reference stays stable across layer drags. Without this the array is
  // freshly built on every render and React.memo's comparator (or the
  // bg component's useEffect deps) would still see a change every tick.
  const bgColors = useMemo(
    () => (bg ? resolveBackgroundColors(bg, state.backgroundColors) : []),
    [bg, state.backgroundColors],
  );
  const showGuides = showSelection && (snapAxes?.x || snapAxes?.y);
  return (
    <div
      className="relative overflow-hidden isolate select-none"
      style={{ width, height, backgroundColor: "#000" }}
      onPointerDown={onBackgroundPointerDown}
    >
      <div
        className="absolute inset-0"
        style={{ opacity: state.backgroundOpacity }}
      >
        <MemoBackground
          bg={bg}
          width={width}
          height={height}
          colors={bgColors}
          gradientParams={state.gradientParams}
        />
      </div>
      {state.layers.map((layer) => (
        <LayerView
          key={layer.id}
          layer={layer}
          width={width}
          height={height}
          selected={state.selectedLayerId === layer.id}
          showSelection={showSelection}
          onPointerDown={onLayerPointerDown}
          onResizePointerDown={onLayerResizePointerDown}
        />
      ))}
      {showGuides ? (
        <SnapGuides x={snapAxes?.x ?? false} y={snapAxes?.y ?? false} />
      ) : null}
    </div>
  );
}

function SnapGuides({ x, y }: { x: boolean; y: boolean }): React.JSX.Element {
  // Velocity-blue centrelines with soft fade at both ends so they read
  // as a Figma-style alignment cue instead of a hard rule across the
  // whole frame. Pointer-events-none so they never intercept a drag.
  const lineColor = "rgba(47,123,255,0.95)";
  const glow = "0 0 8px rgba(47,123,255,0.55)";
  return (
    <div className="pointer-events-none absolute inset-0 z-[100]">
      {x ? (
        <div
          className="absolute left-1/2 top-0 h-full -translate-x-1/2"
          style={{
            width: 1,
            background: `linear-gradient(to bottom, transparent 0%, ${lineColor} 12%, ${lineColor} 88%, transparent 100%)`,
            boxShadow: glow,
          }}
        />
      ) : null}
      {y ? (
        <div
          className="absolute top-1/2 left-0 w-full -translate-y-1/2"
          style={{
            height: 1,
            background: `linear-gradient(to right, transparent 0%, ${lineColor} 12%, ${lineColor} 88%, transparent 100%)`,
            boxShadow: glow,
          }}
        />
      ) : null}
      {x && y ? (
        <div
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{
            width: 8,
            height: 8,
            background: lineColor,
            boxShadow: "0 0 14px rgba(47,123,255,0.85)",
          }}
        />
      ) : null}
    </div>
  );
}

function LayerView({
  layer,
  width,
  height,
  selected,
  showSelection,
  onPointerDown,
  onResizePointerDown,
}: {
  layer: Layer;
  width: number;
  height: number;
  selected: boolean;
  showSelection: boolean;
  onPointerDown?: (id: string, e: React.PointerEvent) => void;
  onResizePointerDown?: (id: string, e: React.PointerEvent) => void;
}): React.JSX.Element {
  const isSelected = showSelection && selected;
  const ringStyle: React.CSSProperties = isSelected
    ? {
        outline: "1.5px solid rgba(47,123,255,0.9)",
        outlineOffset: 4,
      }
    : {};
  const baseStyle: React.CSSProperties = {
    position: "absolute",
    top: `${layer.y * 100}%`,
    left: `${layer.x * 100}%`,
    transform: `translate(-50%, -50%) rotate(${layer.rotation}deg)`,
    opacity: layer.opacity,
    cursor: onPointerDown ? "grab" : "default",
    ...ringStyle,
  };

  const handle = (e: React.PointerEvent): void => {
    if (!onPointerDown) return;
    e.stopPropagation();
    onPointerDown(layer.id, e);
  };
  const resize = (e: React.PointerEvent): void => {
    if (!onResizePointerDown) return;
    e.stopPropagation();
    onResizePointerDown(layer.id, e);
  };

  const handles =
    isSelected && onResizePointerDown ? (
      <>
        <ResizeHandle corner="tl" onPointerDown={resize} />
        <ResizeHandle corner="tr" onPointerDown={resize} />
        <ResizeHandle corner="bl" onPointerDown={resize} />
        <ResizeHandle corner="br" onPointerDown={resize} />
      </>
    ) : null;

  if (layer.type === "text")
    return (
      <TextLayerView layer={layer} height={height} baseStyle={baseStyle} onPointerDown={handle}>
        {handles}
      </TextLayerView>
    );
  if (layer.type === "image")
    return (
      <ImageLayerView
        layer={layer}
        width={width}
        height={height}
        baseStyle={baseStyle}
        onPointerDown={handle}
      >
        {handles}
      </ImageLayerView>
    );
  return (
    <LineLayerView
      layer={layer}
      width={width}
      height={height}
      baseStyle={baseStyle}
      onPointerDown={handle}
    >
      {handles}
    </LineLayerView>
  );
}

function ResizeHandle({
  corner,
  onPointerDown,
}: {
  corner: "tl" | "tr" | "bl" | "br";
  onPointerDown: (e: React.PointerEvent) => void;
}): React.JSX.Element {
  // Each corner needs its own translate sign so the 12x12 handle's
  // CENTRE sits exactly on the outline corner (which is offset 4px
  // outside the content box).
  const positions: Record<
    "tl" | "tr" | "bl" | "br",
    { top?: number; right?: number; bottom?: number; left?: number; transform: string; cursor: string }
  > = {
    tl: { top: -4, left: -4, transform: "translate(-50%, -50%)", cursor: "nwse-resize" },
    tr: { top: -4, right: -4, transform: "translate(50%, -50%)", cursor: "nesw-resize" },
    bl: { bottom: -4, left: -4, transform: "translate(-50%, 50%)", cursor: "nesw-resize" },
    br: { bottom: -4, right: -4, transform: "translate(50%, 50%)", cursor: "nwse-resize" },
  };
  const p = positions[corner];
  return (
    <div
      onPointerDown={onPointerDown}
      style={{
        position: "absolute",
        top: p.top,
        right: p.right,
        bottom: p.bottom,
        left: p.left,
        width: 11,
        height: 11,
        transform: p.transform,
        background: "#0E1015",
        border: "1.5px solid rgba(47,123,255,0.95)",
        borderRadius: 2,
        cursor: p.cursor,
        zIndex: 20,
        boxShadow: "0 1px 6px rgba(0,0,0,0.4)",
        touchAction: "none",
      }}
    />
  );
}

function TextLayerView({
  layer,
  height,
  baseStyle,
  onPointerDown,
  children,
}: {
  layer: TextLayer;
  height: number;
  baseStyle: React.CSSProperties;
  onPointerDown: (e: React.PointerEvent) => void;
  children?: React.ReactNode;
}): React.JSX.Element {
  const fontFamily = layer.font === "brand" ? "var(--font-brand)" : "var(--font-geist-sans)";
  const shadows: string[] = [];
  if (layer.shadow) {
    shadows.push("0 1px 2px rgba(0,0,0,0.6)", "0 4px 14px rgba(0,0,0,0.45)");
  }
  if (layer.glow) {
    shadows.push(`0 0 24px ${layer.glow}`, `0 0 60px ${layer.glow}`);
  }
  return (
    <div style={baseStyle} onPointerDown={onPointerDown}>
      <span
        style={{
          fontFamily,
          fontSize: layer.size * height,
          fontWeight: layer.weight,
          letterSpacing: `${layer.tracking}em`,
          lineHeight: layer.lineHeight,
          color: layer.color,
          textTransform: layer.uppercase ? "uppercase" : "none",
          textAlign: layer.align,
          display: "block",
          whiteSpace: "pre",
          textShadow: shadows.length ? shadows.join(", ") : "none",
        }}
      >
        {layer.text}
      </span>
      {children}
    </div>
  );
}

function ImageLayerView({
  layer,
  width,
  height,
  baseStyle,
  onPointerDown,
  children,
}: {
  layer: ImageLayer;
  width: number;
  height: number;
  baseStyle: React.CSSProperties;
  onPointerDown: (e: React.PointerEvent) => void;
  children?: React.ReactNode;
}): React.JSX.Element {
  const w = layer.width * width;
  const h = layer.height > 0 ? layer.height * height : w;
  // Feather radius is normalised: 0 = no mask, 1 = fully soft. Map it to
  // a radial-gradient with the opaque core shrinking and the falloff
  // band widening as r grows.
  const r = Math.max(0, Math.min(1, layer.featherRadius));
  const opaqueStop = Math.max(0, 60 - r * 50);
  const halfStop = Math.max(opaqueStop + 5, 85 - r * 5);
  const mask =
    r > 0
      ? `radial-gradient(circle at 50% 50%, #000 0%, #000 ${opaqueStop}%, rgba(0,0,0,0.65) ${halfStop}%, rgba(0,0,0,0) 96%)`
      : undefined;
  return (
    <div style={baseStyle} onPointerDown={onPointerDown}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={layer.src}
        alt=""
        width={w}
        height={h}
        draggable={false}
        style={{
          width: w,
          height: h,
          display: "block",
          filter: layer.filter || undefined,
          maskImage: mask,
          WebkitMaskImage: mask,
          // The DOM <img> ships with a default vertical baseline; force
          // block-fit so the wrapping div's bounding box matches the
          // visible image exactly. Matters for the selection outline.
          objectFit: "contain",
          pointerEvents: "none",
        }}
      />
      {children}
    </div>
  );
}

function LineLayerView({
  layer,
  width,
  height,
  baseStyle,
  onPointerDown,
  children,
}: {
  layer: LineLayer;
  width: number;
  height: number;
  baseStyle: React.CSSProperties;
  onPointerDown: (e: React.PointerEvent) => void;
  children?: React.ReactNode;
}): React.JSX.Element {
  const len =
    layer.orientation === "vertical" ? layer.length * height : layer.length * width;
  const background = layer.fade
    ? layer.orientation === "vertical"
      ? `linear-gradient(to bottom, transparent 0%, ${layer.color} 20%, ${layer.color} 80%, transparent 100%)`
      : `linear-gradient(to right, transparent 0%, ${layer.color} 20%, ${layer.color} 80%, transparent 100%)`
    : layer.color;
  return (
    <div style={baseStyle} onPointerDown={onPointerDown}>
      <div
        style={{
          width: layer.orientation === "vertical" ? layer.thickness : len,
          height: layer.orientation === "vertical" ? len : layer.thickness,
          background,
          pointerEvents: "none",
        }}
      />
      {children}
    </div>
  );
}

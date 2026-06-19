"use client";

/**
 * Visual editor for the /social card studio.
 *
 * Layout:
 *   ┌──────────────────────────────┬─────────────────┐
 *   │  Top bar  (format toggle + export)              │
 *   ├──────────────────────────────┬─────────────────┤
 *   │                              │  Templates       │
 *   │       scaled canvas          │  Backgrounds     │
 *   │                              │  Layers          │
 *   │                              │  Inspector       │
 *   └──────────────────────────────┴─────────────────┘
 *
 * State lives in a single useReducer so JSON save/load is one round-trip
 * and templates apply by replacing it wholesale. Layer positions are
 * stored as fractions (0..1) of the canvas, so a single design composes
 * identically at X (1200x675) and LinkedIn (1200x627).
 *
 * Drag: pointerDown on a layer captures the pointer and seeds drag state;
 * pointerMove on the canvas frame writes the new fractional position back
 * into the layer. Selection chrome (the outline) is suppressed while the
 * snapshot path runs so it never bakes into the PNG.
 */

import { toPng } from "html-to-image";
import JSZip from "jszip";
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  Crown,
  Link2,
  Minus,
  Sparkles,
  Type,
  Upload,
  X,
} from "lucide-react";
import { BACKGROUNDS, BACKGROUND_BY_ID, resolveBackgroundColors } from "./backgrounds";
import { SocialCanvas } from "./SocialCanvas";
import { assetUrl, healAssetSrc } from "./assetUrl";
import { TEMPLATES, TEMPLATE_BY_ID } from "./templates";
import type {
  CanvasState,
  Format,
  GradientParams,
  ImageLayer,
  Layer,
  LineLayer,
  TextLayer,
} from "./types";
import { DEFAULT_GRADIENT_PARAMS, FORMAT_DIMS } from "./types";

const STORAGE_KEY = "velocity.social.editor.v1";

type Action =
  | { type: "SET_FORMAT"; format: Format }
  | { type: "SET_BACKGROUND"; backgroundId: string }
  | { type: "SET_BACKGROUND_COLORS"; colors: string[] | null }
  | { type: "SET_BACKGROUND_OPACITY"; opacity: number }
  | { type: "SET_GRADIENT_PARAMS"; patch: Partial<GradientParams> }
  | { type: "ADD_LAYER"; layer: Layer }
  | { type: "UPDATE_LAYER"; id: string; update: (layer: Layer) => Layer }
  | { type: "DELETE_LAYER"; id: string }
  | { type: "SELECT_LAYER"; id: string | null }
  | { type: "MOVE_LAYER"; id: string; direction: "up" | "down" }
  | { type: "DUPLICATE_LAYER"; id: string; newId: string }
  | { type: "BRING_TO_FRONT"; id: string }
  | { type: "SEND_TO_BACK"; id: string }
  | { type: "APPLY_TEMPLATE"; templateId: string }
  | { type: "LOAD_STATE"; state: CanvasState };

function reducer(state: CanvasState, action: Action): CanvasState {
  switch (action.type) {
    case "SET_FORMAT":
      return { ...state, format: action.format };
    case "SET_BACKGROUND":
      // Switching backgrounds drops any prior colour override - the slot
      // count rarely matches across backgrounds, and the user expects
      // each background to start at its Velocity defaults.
      return {
        ...state,
        backgroundId: action.backgroundId,
        backgroundColors: null,
      };
    case "SET_BACKGROUND_COLORS":
      return { ...state, backgroundColors: action.colors };
    case "SET_BACKGROUND_OPACITY":
      return {
        ...state,
        backgroundOpacity: Math.max(0, Math.min(1, action.opacity)),
      };
    case "SET_GRADIENT_PARAMS":
      return {
        ...state,
        gradientParams: { ...state.gradientParams, ...action.patch },
      };
    case "ADD_LAYER":
      return {
        ...state,
        layers: [...state.layers, action.layer],
        selectedLayerId: action.layer.id,
      };
    case "UPDATE_LAYER":
      return {
        ...state,
        layers: state.layers.map((l) => (l.id === action.id ? action.update(l) : l)),
      };
    case "DELETE_LAYER":
      return {
        ...state,
        layers: state.layers.filter((l) => l.id !== action.id),
        selectedLayerId:
          state.selectedLayerId === action.id ? null : state.selectedLayerId,
      };
    case "SELECT_LAYER":
      return { ...state, selectedLayerId: action.id };
    case "MOVE_LAYER": {
      const idx = state.layers.findIndex((l) => l.id === action.id);
      if (idx < 0) return state;
      const target = action.direction === "up" ? idx + 1 : idx - 1;
      if (target < 0 || target >= state.layers.length) return state;
      const moved = state.layers[idx];
      if (!moved) return state;
      const next = state.layers.slice();
      next.splice(idx, 1);
      next.splice(target, 0, moved);
      return { ...state, layers: next };
    }
    case "DUPLICATE_LAYER": {
      const src = state.layers.find((l) => l.id === action.id);
      if (!src) return state;
      // Offset the clone by 4% in both axes so it sits visibly off the
      // original; clamp so it doesn't fall off the canvas.
      const copy: Layer = {
        ...src,
        id: action.newId,
        x: Math.min(0.96, src.x + 0.04),
        y: Math.min(0.96, src.y + 0.04),
      };
      return {
        ...state,
        layers: [...state.layers, copy],
        selectedLayerId: copy.id,
      };
    }
    case "BRING_TO_FRONT": {
      const idx = state.layers.findIndex((l) => l.id === action.id);
      if (idx < 0 || idx === state.layers.length - 1) return state;
      const next = state.layers.slice();
      const moved = next.splice(idx, 1)[0];
      if (!moved) return state;
      next.push(moved);
      return { ...state, layers: next };
    }
    case "SEND_TO_BACK": {
      const idx = state.layers.findIndex((l) => l.id === action.id);
      if (idx <= 0) return state;
      const next = state.layers.slice();
      const moved = next.splice(idx, 1)[0];
      if (!moved) return state;
      next.unshift(moved);
      return { ...state, layers: next };
    }
    case "APPLY_TEMPLATE": {
      const t = TEMPLATE_BY_ID[action.templateId];
      if (!t) return state;
      return { ...t.state, selectedLayerId: null };
    }
    case "LOAD_STATE":
      return action.state;
    default:
      return state;
  }
}

function initialState(): CanvasState {
  const t = TEMPLATE_BY_ID["hiring-bd"] ?? TEMPLATES[0];
  // TEMPLATES is non-empty so this fallback is structurally guaranteed,
  // but TS doesn't see that. Force-narrow with a runtime guard.
  if (!t) {
    return {
      format: "x",
      backgroundId: "black",
      backgroundColors: null,
      backgroundOpacity: 1,
      gradientParams: { ...DEFAULT_GRADIENT_PARAMS },
      layers: [],
      selectedLayerId: null,
    };
  }
  return { ...t.state, selectedLayerId: null };
}

let _nextId = 1000;
function nid(): string {
  return `n${++_nextId}_${Math.random().toString(36).slice(2, 6)}`;
}

function newTextLayer(): TextLayer {
  return {
    id: nid(),
    type: "text",
    text: "New text",
    font: "sans",
    size: 0.06,
    weight: 500,
    tracking: -0.02,
    lineHeight: 1.1,
    color: "#ffffff",
    uppercase: false,
    align: "center",
    shadow: false,
    glow: null,
    x: 0.5,
    y: 0.5,
    opacity: 1,
    rotation: 0,
  };
}

function newImageLayer(src: string): ImageLayer {
  return {
    id: nid(),
    type: "image",
    src,
    x: 0.5,
    y: 0.5,
    width: 0.25,
    height: 0,
    opacity: 1,
    rotation: 0,
    filter: "",
    featherRadius: 0,
  };
}

function newLineLayer(): LineLayer {
  return {
    id: nid(),
    type: "line",
    orientation: "vertical",
    length: 0.2,
    thickness: 1,
    color: "rgba(255,255,255,0.5)",
    fade: true,
    x: 0.5,
    y: 0.5,
    opacity: 1,
    rotation: 0,
  };
}

function newWordmarkLayer(text = "Velocity"): TextLayer {
  return {
    id: nid(),
    type: "text",
    text,
    font: "brand",
    size: 0.08,
    weight: 600,
    tracking: -0.03,
    lineHeight: 1,
    color: "#ffffff",
    uppercase: false,
    align: "center",
    shadow: false,
    glow: null,
    x: 0.5,
    y: 0.5,
    opacity: 1,
    rotation: 0,
  };
}

interface DragState {
  id: string;
  mode: "move" | "resize";
  startClientX: number;
  startClientY: number;
  startX: number;
  startY: number;
  // Resize-only: the layer's centre in client coords at grab time, the
  // initial distance from that centre to the pointer, the layer's
  // starting "size" value (size/width/length depending on layer type),
  // which prop the resize writes back to, and the image's H/W aspect
  // ratio (0 = auto-square or not-image) so image resizes preserve
  // shape.
  centerClientX?: number;
  centerClientY?: number;
  startDist?: number;
  startSize?: number;
  resizeProp?: "size" | "width" | "length";
  aspect?: number;
}

export function SocialEditor(): React.JSX.Element {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  const dims = FORMAT_DIMS[state.format];
  const frameRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const jsonInputRef = useRef<HTMLInputElement>(null);

  // Display scale: render the canvas at its native (1200x*) dims, then
  // scale it down with a CSS transform so it fits the editor stage.
  // html-to-image captures the unscaled DOM, so the export comes out at
  // native resolution regardless of how the editor is zoomed.
  const [scale, setScale] = useState(1);
  useEffect(() => {
    if (!stageRef.current) return;
    const stage = stageRef.current;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const w = entry.contentRect.width;
      // 40px padding inside the stage so the canvas never butts against the
      // stage chrome.
      const usable = Math.max(0, w - 40);
      setScale(Math.min(1, usable / dims.width));
    });
    ro.observe(stage);
    return () => ro.disconnect();
  }, [dims.width]);

  // Persistence: write state to localStorage on every change, restore on
  // mount. Doing the restore in an effect avoids SSR hydration mismatch.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as CanvasState;
        if (parsed && parsed.layers && parsed.backgroundId) {
          // Normalise legacy state saved before backgroundColors /
          // backgroundOpacity / gradientParams existed so older designs
          // still load cleanly. Each field falls back to its current
          // default if absent on disk.
          const normalised: CanvasState = {
            ...parsed,
            backgroundColors: parsed.backgroundColors ?? null,
            backgroundOpacity:
              typeof parsed.backgroundOpacity === "number"
                ? parsed.backgroundOpacity
                : 1,
            gradientParams: {
              ...DEFAULT_GRADIENT_PARAMS,
              ...(parsed.gradientParams ?? {}),
            },
            // Repair image layers saved with a root-absolute public path
            // ("/tier/...", "/social/...") before the base-path fix, so the
            // Apex crown and SpaceX wordmark load under the Pages sub-path.
            layers: Array.isArray(parsed.layers)
              ? parsed.layers.map((l) =>
                  l.type === "image" ? { ...l, src: healAssetSrc(l.src) } : l,
                )
              : parsed.layers,
          };
          // Old saves may still reference the "grid" background that
          // was removed in favour of the custom gradient.
          if (normalised.backgroundId === "grid") {
            normalised.backgroundId = "custom-gradient";
          }
          dispatch({ type: "LOAD_STATE", state: normalised });
        }
      }
    } catch {
      // ignore corrupt saved state
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // quota / disabled storage - silent
    }
  }, [state]);

  // Drag handling. Pointer capture lives on the layer itself; the move +
  // up listeners hang off the frame so a fast drag that briefly leaves
  // the layer box still reaches us.
  const [drag, setDrag] = useState<DragState | null>(null);
  // Live snap indicator: which axes the current drag is snapped on.
  // Used to render the cyan centreline guides over the canvas while
  // the layer's centroid sits on the 50% axis.
  const [snapAxes, setSnapAxes] = useState<{ x: boolean; y: boolean }>({
    x: false,
    y: false,
  });

  // Inline text editing: double-click a text layer on the canvas to edit it
  // in place. Edits flow back through UPDATE_LAYER; blur / Escape ends it.
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const startTextEdit = useCallback((id: string) => {
    dispatch({ type: "SELECT_LAYER", id });
    setEditingTextId(id);
  }, []);
  const handleTextInput = useCallback((id: string, text: string) => {
    dispatch({
      type: "UPDATE_LAYER",
      id,
      update: (l) => (l.type === "text" ? { ...l, text } : l),
    });
  }, []);
  const endTextEdit = useCallback(() => setEditingTextId(null), []);

  const handleLayerPointerDown = useCallback(
    (id: string, e: React.PointerEvent) => {
      const layer = state.layers.find((l) => l.id === id);
      if (!layer) return;
      try {
        (e.target as Element).setPointerCapture(e.pointerId);
      } catch {
        // pointerCapture is unsupported on some virtual elements - safe to ignore.
      }
      dispatch({ type: "SELECT_LAYER", id });
      setDrag({
        id,
        mode: "move",
        startClientX: e.clientX,
        startClientY: e.clientY,
        startX: layer.x,
        startY: layer.y,
      });
    },
    [state.layers],
  );

  const handleLayerResizePointerDown = useCallback(
    (id: string, e: React.PointerEvent) => {
      if (!frameRef.current) return;
      const layer = state.layers.find((l) => l.id === id);
      if (!layer) return;
      try {
        (e.target as Element).setPointerCapture(e.pointerId);
      } catch {
        // safe to ignore on virtual elements
      }
      const rect = frameRef.current.getBoundingClientRect();
      const cx = rect.left + layer.x * rect.width;
      const cy = rect.top + layer.y * rect.height;
      const startDist = Math.max(1, Math.hypot(e.clientX - cx, e.clientY - cy));
      let startSize: number;
      let resizeProp: "size" | "width" | "length";
      let aspect = 0;
      if (layer.type === "text") {
        startSize = layer.size;
        resizeProp = "size";
      } else if (layer.type === "image") {
        startSize = layer.width;
        resizeProp = "width";
        aspect = layer.height > 0 && layer.width > 0 ? layer.height / layer.width : 0;
      } else {
        startSize = layer.length;
        resizeProp = "length";
      }
      dispatch({ type: "SELECT_LAYER", id });
      setDrag({
        id,
        mode: "resize",
        startClientX: e.clientX,
        startClientY: e.clientY,
        startX: layer.x,
        startY: layer.y,
        centerClientX: cx,
        centerClientY: cy,
        startDist,
        startSize,
        resizeProp,
        aspect,
      });
    },
    [state.layers],
  );

  const handleFramePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!drag || !frameRef.current) return;
      const rect = frameRef.current.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;

      if (drag.mode === "resize") {
        // Distance-from-centre uniform scale. The handle's screen
        // position rotates with the layer, but distance is direction-
        // independent so rotated layers resize naturally too.
        const cx = drag.centerClientX ?? 0;
        const cy = drag.centerClientY ?? 0;
        const startDist = drag.startDist ?? 1;
        const startSize = drag.startSize ?? 0.1;
        const newDist = Math.hypot(e.clientX - cx, e.clientY - cy);
        const ratio = newDist / startDist;
        const next = Math.max(0.005, Math.min(2, startSize * ratio));
        const prop = drag.resizeProp;
        const aspect = drag.aspect ?? 0;
        dispatch({
          type: "UPDATE_LAYER",
          id: drag.id,
          update: (l) => {
            if (prop === "size" && l.type === "text") return { ...l, size: next };
            if (prop === "width" && l.type === "image") {
              return {
                ...l,
                width: next,
                height: aspect > 0 ? next * aspect : 0,
              };
            }
            if (prop === "length" && l.type === "line") return { ...l, length: next };
            return l;
          },
        });
        return;
      }

      const dx = (e.clientX - drag.startClientX) / rect.width;
      const dy = (e.clientY - drag.startClientY) / rect.height;
      let nx = drag.startX + dx;
      let ny = drag.startY + dy;
      // Snap to centreline by default. Hold shift while dragging to
      // bypass the snap and place the layer freely.
      let snappedX = false;
      let snappedY = false;
      if (!e.shiftKey) {
        const THRESHOLD = 0.018;
        if (Math.abs(nx - 0.5) < THRESHOLD) {
          nx = 0.5;
          snappedX = true;
        }
        if (Math.abs(ny - 0.5) < THRESHOLD) {
          ny = 0.5;
          snappedY = true;
        }
      }
      if (snappedX !== snapAxes.x || snappedY !== snapAxes.y) {
        setSnapAxes({ x: snappedX, y: snappedY });
      }
      const id = drag.id;
      dispatch({
        type: "UPDATE_LAYER",
        id,
        update: (l) => ({ ...l, x: nx, y: ny }),
      });
    },
    [drag, snapAxes],
  );

  const handleFramePointerUp = useCallback(() => {
    setDrag(null);
    setSnapAxes({ x: false, y: false });
  }, []);

  const handleBackgroundPointerDown = useCallback((_e: React.PointerEvent) => {
    // Click on bare canvas = deselect. Layer + resize-handle pointerdowns
    // both call stopPropagation, so any pointerdown that reaches this
    // handler is guaranteed to be on the background (WebGL canvas, gradient
    // divs, etc) — there's no layer underneath the cursor. The previous
    // `e.target === e.currentTarget` guard was too strict: background
    // backgrounds mount nested canvas/divs, so the target is almost never
    // the outer frame, and the deselect never fired.
    dispatch({ type: "SELECT_LAYER", id: null });
    setEditingTextId(null);
  }, []);

  // Keyboard nudges on the selected layer. Arrow = 1%, shift+arrow = 5%,
  // Delete / Backspace = remove the layer.
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      const id = state.selectedLayerId;
      if (!id) return;
      const isInput =
        document.activeElement instanceof HTMLInputElement ||
        document.activeElement instanceof HTMLTextAreaElement ||
        document.activeElement instanceof HTMLSelectElement ||
        (document.activeElement instanceof HTMLElement &&
          document.activeElement.isContentEditable);
      if (isInput) return;
      const step = e.shiftKey ? 0.05 : 0.01;
      if (e.key === "ArrowLeft") {
        dispatch({ type: "UPDATE_LAYER", id, update: (l) => ({ ...l, x: l.x - step }) });
        e.preventDefault();
      } else if (e.key === "ArrowRight") {
        dispatch({ type: "UPDATE_LAYER", id, update: (l) => ({ ...l, x: l.x + step }) });
        e.preventDefault();
      } else if (e.key === "ArrowUp") {
        dispatch({ type: "UPDATE_LAYER", id, update: (l) => ({ ...l, y: l.y - step }) });
        e.preventDefault();
      } else if (e.key === "ArrowDown") {
        dispatch({ type: "UPDATE_LAYER", id, update: (l) => ({ ...l, y: l.y + step }) });
        e.preventDefault();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        dispatch({ type: "DELETE_LAYER", id });
        e.preventDefault();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state.selectedLayerId]);

  // -- Export --------------------------------------------------------------

  const [exporting, setExporting] = useState<string | null>(null);
  const [showSelection, setShowSelection] = useState(true);

  const exportBoth = useCallback(async () => {
    if (!frameRef.current) return;
    setShowSelection(false);
    setEditingTextId(null);
    const prevSelected = state.selectedLayerId;
    const prevFormat = state.format;
    dispatch({ type: "SELECT_LAYER", id: null });
    try {
      // Bundle both PNGs into a single ZIP so the export is one
      // user-initiated download. Chrome's "this site is asking to
      // download multiple files" prompt only kicks in when triggerDownload
      // fires more than once per click — with a single .zip blob it
      // never appears, and re-exporting can never be silently blocked
      // by a stale permission decision from a prior run.
      const formats: Format[] = ["x", "linkedin"];
      const zip = new JSZip();
      for (const fmt of formats) {
        dispatch({ type: "SET_FORMAT", format: fmt });
        const d = FORMAT_DIMS[fmt];
        setExporting(`${d.label} · ${d.width}×${d.height}`);
        await wait(350);
        const png = await toPng(frameRef.current, {
          pixelRatio: 2,
          cacheBust: true,
          backgroundColor: "#000",
          width: d.width,
          height: d.height,
        });
        const b64 = png.replace(/^data:image\/png;base64,/, "");
        zip.file(
          `velocity-social-${fmt}-${d.width}x${d.height}.png`,
          b64,
          { base64: true },
        );
      }
      setExporting("Packing ZIP…");
      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      try {
        triggerDownload(url, "velocity-social.zip");
      } finally {
        // Give the browser a tick to start the download before revoking.
        setTimeout(() => URL.revokeObjectURL(url), 4000);
      }
    } finally {
      // Restore the user's preview format + selection so clicking
      // download doesn't disturb whatever they were doing.
      dispatch({ type: "SET_FORMAT", format: prevFormat });
      setExporting(null);
      setShowSelection(true);
      if (prevSelected) dispatch({ type: "SELECT_LAYER", id: prevSelected });
    }
  }, [state.selectedLayerId, state.format]);

  // -- File upload (image layer) ------------------------------------------

  const handleUploadImage = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      if (typeof dataUrl !== "string") return;
      dispatch({ type: "ADD_LAYER", layer: newImageLayer(dataUrl) });
    };
    reader.readAsDataURL(file);
  }, []);

  const handleAddImageUrl = useCallback(() => {
    const url = window.prompt(
      "Paste an image URL (https://… or /path).\n\nNote: external hosts must allow CORS or the PNG export will skip the image.",
    );
    if (!url) return;
    const trimmed = url.trim();
    const looksValid =
      /^https?:\/\//i.test(trimmed) ||
      trimmed.startsWith("data:image/") ||
      trimmed.startsWith("/");
    if (!looksValid) return;
    dispatch({ type: "ADD_LAYER", layer: newImageLayer(trimmed) });
  }, []);

  // -- JSON save / load ---------------------------------------------------

  const handleSaveJson = useCallback(() => {
    const blob = new Blob([JSON.stringify(state, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `velocity-social-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [state]);

  const handleLoadJson = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as CanvasState;
        if (parsed && Array.isArray(parsed.layers) && typeof parsed.backgroundId === "string") {
          dispatch({ type: "LOAD_STATE", state: parsed });
        }
      } catch {
        // bad JSON - ignore silently rather than alert
      }
    };
    reader.readAsText(file);
  }, []);

  const selectedLayer = useMemo(
    () => state.layers.find((l) => l.id === state.selectedLayerId) ?? null,
    [state.layers, state.selectedLayerId],
  );

  return (
    <main className="relative flex h-screen w-screen flex-col overflow-hidden bg-[#0A0B0F] text-white">
      <TopBar
        format={state.format}
        onFormat={(f) => dispatch({ type: "SET_FORMAT", format: f })}
        onExport={exportBoth}
        exporting={exporting}
      />

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[280px] min-w-[280px] flex-col border-r border-white/[0.07] bg-[#0E1015]">
          <div className="flex-1 overflow-y-auto">
            <Section title="Templates">
              <div className="grid grid-cols-2 gap-2">
                {TEMPLATES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => dispatch({ type: "APPLY_TEMPLATE", templateId: t.id })}
                    className="rounded-md border border-white/10 bg-white/[0.03] px-2.5 py-2 text-left text-[12px] text-white/75 transition hover:border-white/20 hover:bg-white/[0.06] hover:text-white"
                  >
                    {t.name}
                  </button>
                ))}
              </div>
            </Section>

            <Section title="Background">
              <div className="grid grid-cols-3 gap-1.5">
                {BACKGROUNDS.map((bg) => {
                  const active = bg.id === state.backgroundId;
                  return (
                    <button
                      key={bg.id}
                      type="button"
                      onClick={() => dispatch({ type: "SET_BACKGROUND", backgroundId: bg.id })}
                      className={
                        "group relative aspect-video overflow-hidden rounded-md border transition " +
                        (active
                          ? "border-velocity ring-1 ring-velocity/40"
                          : "border-white/10 hover:border-white/25")
                      }
                      title={bg.name}
                    >
                      <bg.render width={120} height={68} colors={bg.defaultColors} />
                    </button>
                  );
                })}
              </div>
              <div className="mt-2 text-[11px] text-white/40">
                Hover for name. Active: <span className="text-white/75">{BACKGROUNDS.find((b) => b.id === state.backgroundId)?.name}</span>
              </div>
              <BackgroundColorEditor
                background={BACKGROUND_BY_ID[state.backgroundId]}
                override={state.backgroundColors}
                onChange={(colors) =>
                  dispatch({ type: "SET_BACKGROUND_COLORS", colors })
                }
              />
              <BackgroundOpacityEditor
                value={state.backgroundOpacity}
                onChange={(opacity) =>
                  dispatch({ type: "SET_BACKGROUND_OPACITY", opacity })
                }
              />
              {state.backgroundId === "custom-gradient" ? (
                <GradientParamsEditor
                  params={state.gradientParams}
                  onChange={(patch) =>
                    dispatch({ type: "SET_GRADIENT_PARAMS", patch })
                  }
                />
              ) : null}
            </Section>
          </div>
        </aside>

        <section
          ref={stageRef}
          className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden"
          style={{ background: "#0A0B0F" }}
        >
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              backgroundImage:
                "linear-gradient(to right, rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.025) 1px, transparent 1px)",
              backgroundSize: "32px 32px",
            }}
          />

          <div
            style={{
              width: dims.width * scale,
              height: dims.height * scale,
              position: "relative",
            }}
          >
            <div
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: dims.width,
                height: dims.height,
                transform: `scale(${scale})`,
                transformOrigin: "top left",
                boxShadow:
                  "0 0 0 1px rgba(255,255,255,0.06), 0 30px 80px -10px rgba(0,0,0,0.7)",
                borderRadius: 4,
                overflow: "hidden",
              }}
              onPointerMove={handleFramePointerMove}
              onPointerUp={handleFramePointerUp}
              onPointerCancel={handleFramePointerUp}
            >
              <div ref={frameRef} style={{ width: dims.width, height: dims.height }}>
                <SocialCanvas
                  state={state}
                  width={dims.width}
                  height={dims.height}
                  showSelection={showSelection}
                  snapAxes={snapAxes}
                  onLayerPointerDown={handleLayerPointerDown}
                  onLayerResizePointerDown={handleLayerResizePointerDown}
                  onBackgroundPointerDown={handleBackgroundPointerDown}
                  editingTextId={editingTextId}
                  onTextDoubleClick={startTextEdit}
                  onTextInput={handleTextInput}
                  onTextEditEnd={endTextEdit}
                />
              </div>
            </div>
          </div>

          <div className="absolute bottom-3 left-3 text-[11px] uppercase tracking-wider text-white/30">
            {dims.width} × {dims.height} · scale {(scale * 100).toFixed(0)}%
          </div>
        </section>

        <aside className="flex w-[340px] min-w-[340px] flex-col border-l border-white/[0.07] bg-[#0E1015]">
          <div className="flex-1 overflow-y-auto">
            <Section title="Add layer">
              <div className="grid grid-cols-2 gap-1.5">
                <AddLayerButton
                  label="Text"
                  icon={<Type size={14} />}
                  onClick={() => dispatch({ type: "ADD_LAYER", layer: newTextLayer() })}
                />
                <AddLayerButton
                  label="Wordmark"
                  icon={<Sparkles size={14} />}
                  onClick={() => dispatch({ type: "ADD_LAYER", layer: newWordmarkLayer() })}
                />
                <AddLayerButton
                  label="Divider"
                  icon={<Minus size={14} className="rotate-90" />}
                  onClick={() => dispatch({ type: "ADD_LAYER", layer: newLineLayer() })}
                />
                <AddLayerButton
                  label="Cross"
                  icon={<X size={14} />}
                  onClick={() =>
                    dispatch({
                      type: "ADD_LAYER",
                      layer: { ...newTextLayer(), text: "×", size: 0.06, color: "rgba(255,255,255,0.45)" },
                    })
                  }
                />
                <AddLayerButton
                  label="Upload"
                  icon={<Upload size={14} />}
                  onClick={() => fileInputRef.current?.click()}
                />
                <AddLayerButton
                  label="Image URL"
                  icon={<Link2 size={14} />}
                  onClick={handleAddImageUrl}
                />
                <AddLayerButton
                  label="Apex crown"
                  icon={<Crown size={14} />}
                  onClick={() => dispatch({ type: "ADD_LAYER", layer: newImageLayer(assetUrl("tier/apex-cutout.png")) })}
                />
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleUploadImage(f);
                  e.target.value = "";
                }}
              />
            </Section>

            <Section title="Layers">
              {state.layers.length === 0 ? (
                <div className="text-[11px] text-white/35">No layers. Add one above.</div>
              ) : (
                <ul className="flex flex-col gap-0.5">
                  {state.layers
                    .slice()
                    .reverse()
                    .map((l, i) => {
                      const realIdx = state.layers.length - 1 - i;
                      const active = l.id === state.selectedLayerId;
                      return (
                        <li
                          key={l.id}
                          className={
                            "flex items-center gap-2 rounded-md px-2 py-1.5 text-[12px] transition " +
                            (active
                              ? "bg-velocity/20 text-white"
                              : "text-white/65 hover:bg-white/[0.04] hover:text-white")
                          }
                        >
                          <button
                            type="button"
                            className="flex-1 truncate text-left"
                            onClick={() => dispatch({ type: "SELECT_LAYER", id: l.id })}
                          >
                            <span className="text-white/40">{realIdx + 1}.</span>{" "}
                            <LayerLabel layer={l} />
                          </button>
                          <button
                            type="button"
                            className="text-white/35 hover:text-white"
                            title="Move up (above neighbours)"
                            onClick={() => dispatch({ type: "MOVE_LAYER", id: l.id, direction: "up" })}
                          >↑</button>
                          <button
                            type="button"
                            className="text-white/35 hover:text-white"
                            title="Move down"
                            onClick={() => dispatch({ type: "MOVE_LAYER", id: l.id, direction: "down" })}
                          >↓</button>
                          <button
                            type="button"
                            className="text-white/35 hover:text-[color:var(--short)]"
                            title="Delete"
                            onClick={() => dispatch({ type: "DELETE_LAYER", id: l.id })}
                          >✕</button>
                        </li>
                      );
                    })}
                </ul>
              )}
            </Section>

            {selectedLayer ? (
              <>
                <Section title="Quick actions">
                  <LayerQuickActions
                    layer={selectedLayer}
                    onUpdate={(update) =>
                      dispatch({ type: "UPDATE_LAYER", id: selectedLayer.id, update })
                    }
                    onDuplicate={() =>
                      dispatch({
                        type: "DUPLICATE_LAYER",
                        id: selectedLayer.id,
                        newId: nid(),
                      })
                    }
                    onBringToFront={() =>
                      dispatch({ type: "BRING_TO_FRONT", id: selectedLayer.id })
                    }
                    onSendToBack={() =>
                      dispatch({ type: "SEND_TO_BACK", id: selectedLayer.id })
                    }
                    onDelete={() =>
                      dispatch({ type: "DELETE_LAYER", id: selectedLayer.id })
                    }
                  />
                </Section>
                <Section title="Inspector">
                  <Inspector
                    layer={selectedLayer}
                    onChange={(update) =>
                      dispatch({ type: "UPDATE_LAYER", id: selectedLayer.id, update })
                    }
                  />
                </Section>
              </>
            ) : null}

            <Section title="Project">
              <div className="grid grid-cols-2 gap-1.5">
                <SmallButton onClick={handleSaveJson}>Save JSON…</SmallButton>
                <SmallButton onClick={() => jsonInputRef.current?.click()}>Load JSON…</SmallButton>
              </div>
              <input
                ref={jsonInputRef}
                type="file"
                accept="application/json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleLoadJson(f);
                  e.target.value = "";
                }}
              />
              <div className="mt-2 text-[11px] leading-relaxed text-white/35">
                Edits auto-save to <code className="text-white/55">localStorage</code>.
                JSON export is for keeping copies of designs you want to revisit.
              </div>
            </Section>
          </div>
        </aside>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Sidebar primitives
// ---------------------------------------------------------------------------

function Section({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="border-b border-white/[0.06] px-4 py-4">
      <div className="mb-2.5 text-[10px] font-medium uppercase tracking-[0.16em] text-white/40">
        {title}
      </div>
      {children}
    </div>
  );
}

function SmallButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-[12px] text-white/75 transition hover:border-white/25 hover:bg-white/[0.07] hover:text-white"
    >
      {children}
    </button>
  );
}

function BackgroundColorEditor({
  background,
  override,
  onChange,
}: {
  background:
    | (typeof import("./backgrounds"))["BACKGROUNDS"][number]
    | undefined;
  override: string[] | null;
  onChange: (colors: string[] | null) => void;
}): React.JSX.Element | null {
  if (!background || background.defaultColors.length === 0) return null;
  const effective = resolveBackgroundColors(background, override);
  const isDefault = !override;
  const setSlot = (index: number, value: string): void => {
    const next = effective.slice();
    next[index] = value;
    onChange(next);
  };
  return (
    <div className="mt-3 rounded-md border border-white/10 bg-white/[0.02] p-2.5">
      <div className="mb-2 flex items-center justify-between text-[11px] uppercase tracking-wider text-white/40">
        <span>Gradient</span>
        <button
          type="button"
          onClick={() => onChange(null)}
          disabled={isDefault}
          className="text-[10px] uppercase tracking-wider text-white/40 transition hover:text-white/80 disabled:cursor-default disabled:opacity-40"
          title="Restore Velocity-blue defaults"
        >
          Reset
        </button>
      </div>
      <div className="flex gap-1.5">
        {effective.map((hex, i) => (
          <ColorSwatch
            key={i}
            value={hex}
            onChange={(value) => setSlot(i, value)}
          />
        ))}
      </div>
    </div>
  );
}

function ColorSwatch({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}): React.JSX.Element {
  // Native color input doubles as the swatch + picker. Stacked label
  // shows the hex so it reads even when the swatch is mid-update.
  return (
    <label className="flex flex-1 flex-col gap-1">
      <span className="relative block h-9 overflow-hidden rounded-md border border-white/10">
        <input
          type="color"
          value={normaliseColorInput(value)}
          onChange={(e) => onChange(e.target.value)}
          className="absolute inset-0 h-full w-full cursor-pointer border-0 bg-transparent p-0"
        />
      </span>
      <span className="block text-center text-[10px] font-mono uppercase tracking-wider text-white/45">
        {value.toUpperCase()}
      </span>
    </label>
  );
}

function GradientParamsEditor({
  params,
  onChange,
}: {
  params: GradientParams;
  onChange: (patch: Partial<GradientParams>) => void;
}): React.JSX.Element {
  const isDefault =
    params.type === DEFAULT_GRADIENT_PARAMS.type &&
    params.angle === DEFAULT_GRADIENT_PARAMS.angle &&
    params.spread === DEFAULT_GRADIENT_PARAMS.spread &&
    params.grain === DEFAULT_GRADIENT_PARAMS.grain;
  return (
    <div className="mt-3 rounded-md border border-white/10 bg-white/[0.02] p-2.5">
      <div className="mb-2 flex items-center justify-between text-[11px] uppercase tracking-wider text-white/40">
        <span>Gradient knobs</span>
        <button
          type="button"
          onClick={() => onChange({ ...DEFAULT_GRADIENT_PARAMS })}
          disabled={isDefault}
          className="text-[10px] uppercase tracking-wider text-white/40 transition hover:text-white/80 disabled:cursor-default disabled:opacity-40"
          title="Restore defaults"
        >
          Reset
        </button>
      </div>

      <div className="mb-2 grid grid-cols-2 gap-1">
        <GradientTypeButton
          active={params.type === "radial"}
          label="Radial"
          onClick={() => onChange({ type: "radial" })}
        />
        <GradientTypeButton
          active={params.type === "linear"}
          label="Linear"
          onClick={() => onChange({ type: "linear" })}
        />
      </div>

      <GradientSlider
        label="Spread"
        value={params.spread}
        min={0}
        max={1}
        step={0.01}
        percent
        onChange={(spread) => onChange({ spread })}
      />
      <GradientSlider
        label="Grain"
        value={params.grain}
        min={0}
        max={1}
        step={0.01}
        percent
        onChange={(grain) => onChange({ grain })}
      />
      {params.type === "linear" ? (
        <GradientSlider
          label="Angle"
          value={params.angle}
          min={0}
          max={360}
          step={1}
          suffix="°"
          onChange={(angle) => onChange({ angle })}
        />
      ) : null}
    </div>
  );
}

function GradientTypeButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "rounded-md border px-2 py-1.5 text-[11px] font-medium transition " +
        (active
          ? "border-velocity bg-velocity/15 text-white"
          : "border-white/10 bg-white/[0.03] text-white/65 hover:border-white/25 hover:text-white")
      }
    >
      {label}
    </button>
  );
}

function GradientSlider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  percent,
  suffix,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (next: number) => void;
  percent?: boolean;
  suffix?: string;
}): React.JSX.Element {
  const f = percent ? 100 : 1;
  return (
    <div className="mt-2">
      <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wider text-white/45">
        <span>{label}</span>
        <NumberField
          value={value * f}
          min={min * f}
          max={max * f}
          step={Number((step * f).toPrecision(6))}
          suffix={percent ? "%" : suffix}
          onCommit={(fv) => onChange(percent ? fv / 100 : fv)}
        />
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
      />
    </div>
  );
}

function BackgroundOpacityEditor({
  value,
  onChange,
}: {
  value: number;
  onChange: (next: number) => void;
}): React.JSX.Element {
  return (
    <div className="mt-3 rounded-md border border-white/10 bg-white/[0.02] p-2.5">
      <div className="mb-2 flex items-center justify-between text-[11px] uppercase tracking-wider text-white/40">
        <span>Opacity</span>
        <div className="flex items-center gap-2">
          <NumberField
            value={value * 100}
            min={0}
            max={100}
            step={1}
            suffix="%"
            onCommit={(fv) => onChange(fv / 100)}
          />
          <button
            type="button"
            onClick={() => onChange(1)}
            disabled={value >= 0.999}
            className="text-[10px] uppercase tracking-wider text-white/40 transition hover:text-white/80 disabled:cursor-default disabled:opacity-40"
            title="Reset to 100%"
          >
            Reset
          </button>
        </div>
      </div>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
      />
    </div>
  );
}

/** <input type="color"> only accepts #rrggbb. Strip alpha or named
 *  colours so the picker doesn't quietly fall back to black. */
function normaliseColorInput(value: string): string {
  if (/^#[0-9a-fA-F]{6}$/.test(value)) return value;
  if (/^#[0-9a-fA-F]{3}$/.test(value)) {
    const h = value.slice(1);
    return (
      "#" +
      h
        .split("")
        .map((c) => c + c)
        .join("")
    );
  }
  return "#2F7BFF";
}

function LayerLabel({ layer }: { layer: Layer }): React.JSX.Element {
  if (layer.type === "text") {
    return (
      <>
        <span className="text-white/40">T</span>{" "}
        <span className="truncate">{layer.text || "(empty)"}</span>
      </>
    );
  }
  if (layer.type === "image") {
    const filename = layer.src.startsWith("data:") ? "uploaded image" : layer.src.split("/").pop();
    return (
      <>
        <span className="text-white/40">I</span>{" "}
        <span className="truncate">{filename}</span>
      </>
    );
  }
  return (
    <>
      <span className="text-white/40">|</span>{" "}
      <span>Line ({layer.orientation})</span>
    </>
  );
}

// ---------------------------------------------------------------------------
// Top bar
// ---------------------------------------------------------------------------

function TopBar({
  format,
  onFormat,
  onExport,
  exporting,
}: {
  format: Format;
  onFormat: (f: Format) => void;
  onExport: () => void;
  exporting: string | null;
}): React.JSX.Element {
  return (
    <header className="flex h-12 items-center justify-between border-b border-white/[0.07] bg-[#0E1015] px-4">
      <div className="flex items-center gap-3">
        <span style={{ fontFamily: "var(--font-brand)", fontWeight: 600, letterSpacing: "-0.02em" }} className="text-[15px]">
          Velocity
        </span>
        <span className="text-white/30">/</span>
        <span className="text-[12px] uppercase tracking-[0.16em] text-white/55">Social studio</span>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex rounded-md border border-white/10 bg-white/[0.04] p-0.5">
          <RatioPill active={format === "x"} onClick={() => onFormat("x")}>X · 16:9</RatioPill>
          <RatioPill active={format === "linkedin"} onClick={() => onFormat("linkedin")}>LinkedIn · 1.91:1</RatioPill>
        </div>
        <button
          type="button"
          onClick={onExport}
          disabled={exporting !== null}
          className="inline-flex items-center gap-2 rounded-md bg-white px-3 py-1.5 text-[12px] font-medium text-black transition hover:bg-white/90 disabled:cursor-wait disabled:opacity-60"
        >
          {exporting ? (
            <>
              <Spinner />
              <span className="text-[11.5px]">Rendering {exporting}</span>
            </>
          ) : (
            <>Download ZIP · X + LinkedIn</>
          )}
        </button>
      </div>
    </header>
  );
}

function RatioPill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "rounded-[5px] px-3 py-1 text-[11.5px] font-medium tracking-tight transition " +
        (active ? "bg-white/10 text-white" : "text-white/55 hover:text-white/85")
      }
    >
      {children}
    </button>
  );
}

function Spinner(): React.JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden
      style={{ animation: "spin 0.9s linear infinite" }}
    >
      <path d="M8 1.5a6.5 6.5 0 1 0 6.5 6.5" />
      <style>{"@keyframes spin{to{transform:rotate(360deg)}}"}</style>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Quick actions toolbar (alignment / z-order / clone / delete)
// ---------------------------------------------------------------------------

/** Padding from the edge when snapping a layer to a side of the canvas.
 *  6% reads as "in the margin" without crashing into the frame edge. */
const EDGE_PAD = 0.06;

function LayerQuickActions({
  layer,
  onUpdate,
  onDuplicate,
  onBringToFront,
  onSendToBack,
  onDelete,
}: {
  layer: Layer;
  onUpdate: (update: (l: Layer) => Layer) => void;
  onDuplicate: () => void;
  onBringToFront: () => void;
  onSendToBack: () => void;
  onDelete: () => void;
}): React.JSX.Element {
  const setXY = (x: number | null, y: number | null): void => {
    onUpdate((l) => ({
      ...l,
      ...(x !== null ? { x } : {}),
      ...(y !== null ? { y } : {}),
    }));
  };
  const setRot = (rot: number): void => onUpdate((l) => ({ ...l, rotation: rot }));
  const setOpa = (o: number): void => onUpdate((l) => ({ ...l, opacity: o }));
  const flipRot = (): void =>
    onUpdate((l) => ({ ...l, rotation: ((layer.rotation + 180) % 360 + 360) % 360 - 180 }));

  return (
    <div className="flex flex-col gap-1.5">
      <QuickRow>
        <QA title="Centre horizontally" onClick={() => setXY(0.5, null)}>Ctr X</QA>
        <QA title="Centre vertically" onClick={() => setXY(null, 0.5)}>Ctr Y</QA>
        <QA title="Centre both" onClick={() => setXY(0.5, 0.5)}>Center</QA>
        <QA title="Reset rotation (0°)" onClick={() => setRot(0)}>Rot 0°</QA>
      </QuickRow>
      <QuickRow>
        <QA title="Align top" onClick={() => setXY(null, EDGE_PAD)}>Top</QA>
        <QA title="Align bottom" onClick={() => setXY(null, 1 - EDGE_PAD)}>Bottom</QA>
        <QA title="Align left" onClick={() => setXY(EDGE_PAD, null)}>Left</QA>
        <QA title="Align right" onClick={() => setXY(1 - EDGE_PAD, null)}>Right</QA>
      </QuickRow>
      <QuickRow>
        <QA title="Flip rotation +180°" onClick={flipRot}>Flip</QA>
        <QA title="Reset opacity to 100%" onClick={() => setOpa(1)}>Opacity</QA>
        <QA title="Duplicate layer" onClick={onDuplicate}>Clone</QA>
        <QA title="Delete layer" danger onClick={onDelete}>Delete</QA>
      </QuickRow>
      <QuickRow>
        <QA title="Send to back" onClick={onSendToBack} wide>To back</QA>
        <QA title="Bring to front" onClick={onBringToFront} wide>To front</QA>
      </QuickRow>
    </div>
  );
}

function QuickRow({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="grid grid-cols-4 gap-1.5">{children}</div>;
}

function QA({
  title,
  onClick,
  children,
  danger,
  wide,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
  danger?: boolean;
  wide?: boolean;
}): React.JSX.Element {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={
        "flex h-8 items-center justify-center rounded-md border bg-white/[0.03] px-1.5 text-[10px] font-medium uppercase tracking-[0.06em] transition " +
        (wide ? "col-span-2 " : "") +
        (danger
          ? "border-white/10 text-white/55 hover:border-[color:var(--short)]/60 hover:bg-[color:var(--short)]/15 hover:text-white"
          : "border-white/10 text-white/70 hover:border-white/25 hover:bg-white/[0.07] hover:text-white")
      }
    >
      {children}
    </button>
  );
}


// ---------------------------------------------------------------------------
// Add-layer icon buttons (tooltips carry the labels so the chrome stays terse)
// ---------------------------------------------------------------------------

function AddLayerButton({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="flex h-9 items-center gap-2 rounded-md border border-white/10 bg-white/[0.03] px-2.5 text-[12px] text-white/75 transition hover:border-white/25 hover:bg-white/[0.07] hover:text-white"
    >
      <span className="flex h-4 w-4 items-center justify-center text-white/55 [&>svg]:h-3.5 [&>svg]:w-3.5">
        {icon}
      </span>
      <span className="truncate">{label}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Inspector
// ---------------------------------------------------------------------------

function Inspector({
  layer,
  onChange,
}: {
  layer: Layer;
  onChange: (update: (layer: Layer) => Layer) => void;
}): React.JSX.Element {
  const setPos = (axis: "x" | "y", v: number): void => {
    onChange((l) => ({ ...l, [axis]: v }));
  };
  const setOpacity = (v: number): void => onChange((l) => ({ ...l, opacity: v }));
  const setRotation = (v: number): void => onChange((l) => ({ ...l, rotation: v }));

  return (
    <div className="flex flex-col gap-2.5">
      {layer.type === "text" && <TextInspector layer={layer} onChange={onChange} />}
      {layer.type === "image" && <ImageInspector layer={layer} onChange={onChange} />}
      {layer.type === "line" && <LineInspector layer={layer} onChange={onChange} />}

      <Divider />

      <SliderRow label="X" min={-0.2} max={1.2} step={0.001} value={layer.x} onChange={(v) => setPos("x", v)} percent />
      <SliderRow label="Y" min={-0.2} max={1.2} step={0.001} value={layer.y} onChange={(v) => setPos("y", v)} percent />
      <SliderRow label="Opacity" min={0} max={1} step={0.01} value={layer.opacity} onChange={setOpacity} percent />
      <SliderRow label="Rotation" min={-180} max={180} step={1} value={layer.rotation} onChange={setRotation} suffix="°" />

      <div className="mt-1 text-[10.5px] leading-relaxed text-white/35">
        Drag the layer on the canvas to reposition. Shift-drag snaps to centre. Arrow keys nudge.
      </div>
    </div>
  );
}

function TextInspector({
  layer,
  onChange,
}: {
  layer: TextLayer;
  onChange: (update: (layer: Layer) => Layer) => void;
}): React.JSX.Element {
  const set = <K extends keyof TextLayer>(k: K, v: TextLayer[K]): void =>
    onChange((l) => (l.type === "text" ? { ...l, [k]: v } : l));
  return (
    <>
      <Field label="Text">
        <textarea
          value={layer.text}
          onChange={(e) => set("text", e.target.value)}
          rows={2}
          className="min-h-[36px] w-full resize-none rounded-md border border-white/10 bg-black/30 px-2 py-1 text-[12px] text-white/90 outline-none focus:border-velocity"
        />
      </Field>
      <Field label="Font">
        <select
          value={layer.font}
          onChange={(e) => set("font", e.target.value as TextLayer["font"])}
          className={selectClass}
        >
          <option value="sans">Sans (Geist)</option>
          <option value="brand">Brand (Unbounded)</option>
        </select>
      </Field>
      <Field label="Weight">
        <select
          value={layer.weight}
          onChange={(e) => set("weight", Number(e.target.value) as TextLayer["weight"])}
          className={selectClass}
        >
          {[300, 400, 500, 600, 700].map((w) => (
            <option key={w} value={w}>{w}</option>
          ))}
        </select>
      </Field>
      <SliderRow label="Size" min={0.012} max={0.2} step={0.001} value={layer.size} onChange={(v) => set("size", v)} percent />
      <SliderRow label="Tracking" min={-0.06} max={0.25} step={0.001} value={layer.tracking} onChange={(v) => set("tracking", v)} suffix="em" />
      <SliderRow label="Line height" min={0.9} max={1.6} step={0.01} value={layer.lineHeight} onChange={(v) => set("lineHeight", v)} />
      <Field label="Color">
        <ColorInput value={layer.color} onChange={(v) => set("color", v)} />
      </Field>
      <Field label="Align">
        <select
          value={layer.align}
          onChange={(e) => set("align", e.target.value as TextLayer["align"])}
          className={selectClass}
        >
          <option value="left">Left</option>
          <option value="center">Center</option>
          <option value="right">Right</option>
        </select>
      </Field>
      <CheckboxRow label="Uppercase" checked={layer.uppercase} onChange={(v) => set("uppercase", v)} />
      <CheckboxRow label="Drop shadow" checked={layer.shadow} onChange={(v) => set("shadow", v)} />
      <CheckboxRow
        label="Velocity glow"
        checked={layer.glow !== null}
        onChange={(v) => set("glow", v ? "rgba(47,123,255,0.55)" : null)}
      />
    </>
  );
}

function ImageInspector({
  layer,
  onChange,
}: {
  layer: ImageLayer;
  onChange: (update: (layer: Layer) => Layer) => void;
}): React.JSX.Element {
  const set = <K extends keyof ImageLayer>(k: K, v: ImageLayer[K]): void =>
    onChange((l) => (l.type === "image" ? { ...l, [k]: v } : l));
  return (
    <>
      {layer.src.startsWith("data:") ? (
        <Field label="Source">
          <div className="text-[11px] text-white/50">uploaded image · {Math.round(layer.src.length / 1024)} kB</div>
        </Field>
      ) : (
        <Field label="Source">
          <input
            value={layer.src}
            onChange={(e) => set("src", e.target.value)}
            className={inputClass}
          />
        </Field>
      )}
      <SliderRow label="Width" min={0.05} max={1.2} step={0.001} value={layer.width} onChange={(v) => set("width", v)} percent />
      <SliderRow label="Height" min={0} max={1.2} step={0.001} value={layer.height} onChange={(v) => set("height", v)} percent />
      <SliderRow label="Feather" min={0} max={1} step={0.01} value={layer.featherRadius} onChange={(v) => set("featherRadius", v)} />
      <Field label="CSS filter">
        <input
          value={layer.filter}
          placeholder='e.g. saturate(1.4) brightness(0.9) drop-shadow(0 0 30px rgba(47,123,255,0.5))'
          onChange={(e) => set("filter", e.target.value)}
          className={inputClass}
        />
      </Field>
    </>
  );
}

function LineInspector({
  layer,
  onChange,
}: {
  layer: LineLayer;
  onChange: (update: (layer: Layer) => Layer) => void;
}): React.JSX.Element {
  const set = <K extends keyof LineLayer>(k: K, v: LineLayer[K]): void =>
    onChange((l) => (l.type === "line" ? { ...l, [k]: v } : l));
  return (
    <>
      <Field label="Orientation">
        <select
          value={layer.orientation}
          onChange={(e) => set("orientation", e.target.value as LineLayer["orientation"])}
          className={selectClass}
        >
          <option value="vertical">Vertical</option>
          <option value="horizontal">Horizontal</option>
        </select>
      </Field>
      <SliderRow label="Length" min={0.02} max={1} step={0.01} value={layer.length} onChange={(v) => set("length", v)} percent />
      <SliderRow label="Thickness" min={1} max={12} step={1} value={layer.thickness} onChange={(v) => set("thickness", v)} suffix="px" />
      <Field label="Color">
        <ColorInput value={layer.color} onChange={(v) => set("color", v)} />
      </Field>
      <CheckboxRow label="Fade at ends" checked={layer.fade} onChange={(v) => set("fade", v)} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Tiny form primitives
// ---------------------------------------------------------------------------

const inputClass =
  "w-full rounded-md border border-white/10 bg-black/30 px-2 py-1 text-[12px] text-white/90 outline-none focus:border-velocity";
const selectClass =
  "w-full rounded-md border border-white/10 bg-black/30 px-2 py-1 text-[12px] text-white/90 outline-none focus:border-velocity";

function Field({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <div className="text-[10px] uppercase tracking-[0.14em] text-white/40">{label}</div>
      {children}
    </div>
  );
}

/** Decimal places to show for a given step (e.g. 0.001 -> 3, 1 -> 0). */
function decimalsForStep(step: number): number {
  if (step >= 1) return 0;
  const s = String(step);
  const dot = s.indexOf(".");
  return dot < 0 ? 0 : s.length - dot - 1;
}

/**
 * Editable numeric field kept in sync with a slider. Holds its own text while
 * focused so typing isn't clobbered by re-renders, commits the (clamped) value
 * live so the slider tracks, and reformats on blur.
 */
function NumberField({
  value,
  min,
  max,
  step,
  onCommit,
  suffix,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onCommit: (v: number) => void;
  suffix?: string;
}): React.JSX.Element {
  const decimals = decimalsForStep(step);
  const fmt = (v: number): string => String(Number(v.toFixed(decimals)));
  const [text, setText] = useState(() => fmt(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(fmt(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, focused, step]);
  const clamp = (n: number): number => Math.max(min, Math.min(max, n));
  return (
    <div className="flex items-center gap-1">
      <input
        type="number"
        value={text}
        min={min}
        max={max}
        step={step}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          const n = parseFloat(text);
          if (Number.isNaN(n)) {
            setText(fmt(value));
            return;
          }
          const c = clamp(n);
          onCommit(c);
          setText(fmt(c));
        }}
        onChange={(e) => {
          setText(e.target.value);
          const n = parseFloat(e.target.value);
          if (!Number.isNaN(n)) onCommit(clamp(n));
        }}
        className="w-14 rounded border border-white/10 bg-black/30 px-1 py-0.5 text-right font-mono text-[10px] text-white/75 outline-none focus:border-velocity [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      {suffix ? <span className="text-[10px] text-white/35">{suffix}</span> : null}
    </div>
  );
}

function SliderRow({
  label,
  min,
  max,
  step,
  value,
  onChange,
  percent,
  suffix,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  /** Edit + display the value as a percentage (value * 100). */
  percent?: boolean;
  /** Unit shown after the number field (e.g. "°", "em", "px"). */
  suffix?: string;
}): React.JSX.Element {
  const f = percent ? 100 : 1;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.14em] text-white/40">
        <span>{label}</span>
        <NumberField
          value={value * f}
          min={min * f}
          max={max * f}
          step={Number((step * f).toPrecision(6))}
          suffix={percent ? "%" : suffix}
          onCommit={(fv) => onChange(percent ? fv / 100 : fv)}
        />
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 w-full cursor-ew-resize accent-[#2F7BFF]"
      />
    </div>
  );
}

function CheckboxRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }): React.JSX.Element {
  return (
    <label className="flex cursor-pointer items-center justify-between text-[12px] text-white/75">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 cursor-pointer accent-[#2F7BFF]"
      />
    </label>
  );
}

function ColorInput({ value, onChange }: { value: string; onChange: (v: string) => void }): React.JSX.Element {
  // Strip rgba for the native picker and round-trip back; the text input
  // accepts any CSS color (including rgba with alpha) so users can write
  // semi-transparent values that the swatch can't otherwise express.
  const hex = toHex(value);
  return (
    <div className="flex gap-1.5">
      <input
        type="color"
        value={hex}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 w-9 cursor-pointer rounded border border-white/10 bg-transparent"
      />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={inputClass}
      />
    </div>
  );
}

function toHex(color: string): string {
  if (color.startsWith("#")) return color.slice(0, 7);
  // best effort - the native picker just needs SOMETHING resembling a hex
  const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return "#ffffff";
  const r = Number(m[1]).toString(16).padStart(2, "0");
  const g = Number(m[2]).toString(16).padStart(2, "0");
  const b = Number(m[3]).toString(16).padStart(2, "0");
  return `#${r}${g}${b}`;
}

function Divider(): React.JSX.Element {
  return <div className="h-px w-full bg-white/[0.07]" />;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function triggerDownload(dataUrl: string, filename: string): void {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

"use client";

/**
 * Background registry for the /social editor.
 *
 * Animated backgrounds come from the reactbits.dev library, installed
 * locally via `npx shadcn@latest add @react-bits/<Name>-TS-TW`. Each
 * entry here is just the integration shim — the reactbits component is
 * mounted absolutely inside the canvas frame, and prop values are tuned
 * to a Velocity-blue gradient by default.
 *
 * Every animated background declares a `defaultColors: string[]`. The
 * editor renders one colour input per slot and lets the user override
 * the gradient at design time; if no override is set, defaults apply.
 * Render functions receive the resolved colours via the `colors` arg.
 *
 * Pure Black and Dark Grid are zero-cost CSS utilities — they snapshot
 * to PNG perfectly (no WebGL preserveDrawingBuffer concern) and they
 * have an empty defaultColors so the colour panel hides for them.
 *
 * Add a new background by appending to BACKGROUNDS; the editor picks
 * it up automatically.
 */

import Aurora from "./Aurora";
import ColorBends from "./ColorBends";
import DarkVeil from "./DarkVeil";
import DotField from "./DotField";
import DotGrid from "./DotGrid";
import Grainient from "./Grainient";
import GradientBlinds from "./GradientBlinds";
import Iridescence from "./Iridescence";
import Lightfall from "./Lightfall";
import LightRays from "./LightRays";
import Lightning from "./Lightning";
import LineWaves from "./LineWaves";
import Particles from "./Particles";
import PlasmaWave from "./PlasmaWave";
import SideRays from "./SideRays";
import Silk from "./Silk";
import SoftAurora from "./SoftAurora";
import Threads from "./Threads";
import { DEFAULT_GRADIENT_PARAMS, type GradientParams } from "./types";

interface BgProps {
  width: number;
  height: number;
  colors: string[];
  /** Only consumed by the custom-gradient background; other entries
   *  ignore it. SocialCanvas threads the live params through here so
   *  the user's tweaks render without an extra context layer. */
  gradientParams?: GradientParams;
  /** True only for the live editor canvas. Mouse-driven backgrounds read
   *  the shared, lockable focus point when this is set; the picker
   *  thumbnails leave it false so they render a static, centered preview. */
  interactive?: boolean;
}

export interface Background {
  id: string;
  name: string;
  /** terse 2-3 word descriptor shown under the swatch. */
  hint: string;
  /** colour slots this background renders. Empty array = no colour
   *  inputs (utility backgrounds like Pure Black). The editor sizes
   *  the colour panel from this length. */
  defaultColors: string[];
  render: (props: BgProps) => React.JSX.Element;
}

// === Colour helpers ===

/** Hex (#rrggbb or #rgb) -> [r, g, b] in 0..1, used by shaders that take
 *  RGB tuples instead of hex strings (Iridescence, Threads). */
export function hexToRgb01(hex: string): [number, number, number] {
  let h = hex.replace("#", "");
  if (h.length === 3) {
    h = h.split("").map((c) => c + c).join("");
  }
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  return [
    Number.isFinite(r) ? r : 0,
    Number.isFinite(g) ? g : 0,
    Number.isFinite(b) ? b : 0,
  ];
}

/** Hex -> HSL hue in degrees (0..360). Used by shaders that expose a
 *  single `hue` knob (Lightning, DarkVeil). Returns 0 for greys. */
export function hexToHueDeg(hex: string): number {
  const [r, g, b] = hexToRgb01(hex);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  let h = 0;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return h * 60;
}

/** Inline SVG noise tile used by grain overlays. `feTurbulence` runs the
 *  fractal noise inside the SVG itself; the colour-matrix flattens it
 *  to a translucent monochrome speckle that overlays cleanly via
 *  mix-blend-mode. URL-encoded so it survives in a CSS `url()`. */
const NOISE_DATAURL =
  "data:image/svg+xml;charset=utf-8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="220" height="220">' +
      '<filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/>' +
      '<feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.55 0"/></filter>' +
      '<rect width="100%" height="100%" filter="url(#n)"/></svg>',
  );

// === Custom gradient renderer ===

/**
 * Pure-CSS gradient backdrop driven by the user-tunable GradientParams.
 * No WebGL = perfect snapshot on every export with no preserveDrawingBuffer
 * concerns. The Velocity defaults give it a centred radial bloom with a
 * touch of grain (Privy-leaning baseline).
 */
function CustomGradientBackground({
  colors,
  params,
}: {
  colors: string[];
  params: GradientParams;
}): React.JSX.Element {
  const safeColors = colors.length > 0 ? colors : ["#0A1A3A", "#000000"];
  const stops = safeColors
    .map((c, i) => {
      const pct = safeColors.length === 1
        ? 100
        : Math.round((i / (safeColors.length - 1)) * 100);
      return `${c} ${pct}%`;
    })
    .join(", ");
  // Spread 0..1 -> ellipse radius 25..120% of the canvas. Below 50%
  // reads as a tight glow; near 100% fills the frame edge-to-edge.
  const radiusPct = 25 + params.spread * 95;
  const bg =
    params.type === "radial"
      ? `radial-gradient(ellipse ${radiusPct}% ${radiusPct}% at 50% 50%, ${stops})`
      : `linear-gradient(${params.angle}deg, ${stops})`;
  // Grain opacity tops out at 0.55 so even at slider max the noise
  // texture sits beneath the gradient rather than washing it out.
  const grainOpacity = Math.min(0.55, params.grain * 0.5);
  return (
    <div className="absolute inset-0 bg-black">
      <div className="absolute inset-0" style={{ background: bg }} />
      {grainOpacity > 0 ? (
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `url("${NOISE_DATAURL}")`,
            backgroundSize: "220px 220px",
            backgroundRepeat: "repeat",
            opacity: grainOpacity,
            mixBlendMode: "overlay",
          }}
        />
      ) : null}
    </div>
  );
}

// === Velocity defaults ===

/** 3-stop Velocity gradient: deep / primary / light. */
const V3 = ["#1F6BEF", "#2F7BFF", "#7BB0FF"];
/** 2-stop Velocity gradient: deep + light. */
const V2 = ["#1F6BEF", "#7BB0FF"];
/** Single Velocity primary. */
const V1 = ["#2F7BFF"];

// Tiny helpers to keep the registry concise.
const pick = (colors: string[], idx: number, fallback: string): string =>
  colors[idx] ?? fallback;

// === Registry ===

export const BACKGROUNDS: Background[] = [
  // --- Zero-cost CSS utilities ---
  {
    id: "black",
    name: "Pure Black",
    hint: "clean baseline",
    defaultColors: [],
    render: () => <div className="absolute inset-0 bg-black" />,
  },
  {
    id: "custom-gradient",
    name: "Custom Gradient",
    hint: "fully tunable",
    defaultColors: V3,
    render: ({ colors, gradientParams }) => (
      <CustomGradientBackground
        colors={colors}
        params={gradientParams ?? DEFAULT_GRADIENT_PARAMS}
      />
    ),
  },

  // --- Reactbits animated backgrounds ---
  {
    id: "aurora",
    name: "Aurora",
    hint: "flowing gradient",
    defaultColors: V3,
    render: ({ colors }) => (
      <div className="absolute inset-0 bg-black">
        <Aurora colorStops={colors} amplitude={1.0} blend={0.55} speed={0.8} />
      </div>
    ),
  },
  {
    id: "soft-aurora",
    name: "Soft Aurora",
    hint: "diffuse bands",
    defaultColors: V2,
    render: ({ colors, interactive }) => (
      <div className="absolute inset-0 bg-black">
        <SoftAurora
          color1={pick(colors, 0, V2[0]!)}
          color2={pick(colors, 1, V2[1]!)}
          speed={0.35}
          scale={1.2}
          brightness={0.85}
          noiseFrequency={1.1}
          noiseAmplitude={0.7}
          bandHeight={0.55}
          bandSpread={0.45}
          enableMouseInteraction={interactive}
        />
      </div>
    ),
  },
  {
    id: "grainient",
    name: "Grainient",
    hint: "grainy gradient",
    defaultColors: V3,
    render: ({ colors }) => (
      <div className="absolute inset-0 bg-black">
        <Grainient
          color1={pick(colors, 0, V3[0]!)}
          color2={pick(colors, 1, V3[1]!)}
          color3={pick(colors, 2, V3[2]!)}
          warpStrength={0.65}
          warpFrequency={1.4}
          warpAmplitude={0.55}
          grainAmount={0.18}
          grainAnimated={true}
          saturation={1.1}
          contrast={1.05}
        />
      </div>
    ),
  },
  {
    id: "silk",
    name: "Silk",
    hint: "satin waves",
    defaultColors: V1,
    render: ({ colors }) => (
      <div className="absolute inset-0 bg-black">
        <Silk
          speed={3.5}
          scale={1.1}
          color={pick(colors, 0, V1[0]!)}
          noiseIntensity={1.2}
          rotation={0.12}
        />
      </div>
    ),
  },
  {
    id: "iridescence",
    name: "Iridescence",
    hint: "shimmer sheen",
    defaultColors: V1,
    render: ({ colors, interactive }) => (
      <div className="absolute inset-0 bg-black">
        <Iridescence
          color={hexToRgb01(pick(colors, 0, V1[0]!))}
          speed={0.8}
          amplitude={0.12}
          mouseReact={interactive}
        />
      </div>
    ),
  },
  {
    id: "darkveil",
    name: "Dark Veil",
    hint: "soft veil",
    defaultColors: V1,
    render: ({ colors }) => {
      // DarkVeil is a hue-shift effect; map the first colour to a hue
      // offset so the veil tints to whatever the user picks.
      const targetHue = hexToHueDeg(pick(colors, 0, V1[0]!));
      const hueShift = ((targetHue - 250) + 360) % 360;
      return (
        <div className="absolute inset-0 bg-black">
          <DarkVeil
            hueShift={hueShift}
            noiseIntensity={0.04}
            scanlineIntensity={0}
            speed={0.4}
            warpAmount={0.35}
          />
        </div>
      );
    },
  },
  {
    id: "threads",
    name: "Threads",
    hint: "drifting lines",
    defaultColors: V1,
    render: ({ colors, interactive }) => (
      <div className="absolute inset-0 bg-black">
        <Threads
          color={hexToRgb01(pick(colors, 0, V1[0]!))}
          amplitude={1.1}
          distance={0.25}
          enableMouseInteraction={interactive}
        />
      </div>
    ),
  },
  {
    id: "lightrays",
    name: "Light Rays",
    hint: "radial rays",
    defaultColors: V1,
    render: ({ colors, interactive }) => (
      <div className="absolute inset-0 bg-black">
        <LightRays
          raysColor={pick(colors, 0, V1[0]!)}
          raysSpeed={1.0}
          lightSpread={0.95}
          rayLength={1.6}
          pulsating={false}
          fadeDistance={1.0}
          saturation={1.05}
          followMouse={interactive}
          mouseInfluence={0.5}
          noiseAmount={0.08}
          distortion={0.04}
        />
      </div>
    ),
  },
  {
    id: "side-rays",
    name: "Side Rays",
    hint: "angled rays",
    defaultColors: V2,
    render: ({ colors }) => (
      <div className="absolute inset-0 bg-black">
        <SideRays
          rayColor1={pick(colors, 0, V2[0]!)}
          rayColor2={pick(colors, 1, V2[1]!)}
          speed={0.5}
          intensity={0.95}
          spread={0.85}
          tilt={0.6}
          saturation={1.1}
          blend={0.5}
          falloff={0.55}
          opacity={0.9}
        />
      </div>
    ),
  },
  {
    id: "lightfall",
    name: "Lightfall",
    hint: "vertical streaks",
    defaultColors: V3,
    render: ({ colors, interactive }) => (
      <div className="absolute inset-0 bg-black">
        <Lightfall
          colors={colors}
          backgroundColor="#000000"
          speed={0.6}
          streakCount={90}
          streakWidth={0.6}
          streakLength={0.5}
          glow={0.85}
          density={0.85}
          twinkle={0.7}
          backgroundGlow={0.4}
          mouseInteraction={interactive}
        />
      </div>
    ),
  },
  {
    id: "colorbends",
    name: "Color Bends",
    hint: "warped bands",
    defaultColors: V3,
    render: ({ colors }) => (
      <div className="absolute inset-0 bg-black">
        <ColorBends
          colors={colors}
          rotation={0.4}
          speed={0.4}
          autoRotate={0.05}
          scale={1.0}
          frequency={1.4}
          warpStrength={0.7}
          parallax={0.0}
          noise={0.4}
          iterations={3}
          intensity={0.95}
          bandWidth={0.85}
        />
      </div>
    ),
  },
  {
    id: "plasma-wave",
    name: "Plasma Wave",
    hint: "rolling waves",
    defaultColors: V2,
    render: ({ colors }) => (
      <div className="absolute inset-0 bg-black">
        <PlasmaWave
          colors={[pick(colors, 0, V2[0]!), pick(colors, 1, V2[1]!)]}
          rotationDeg={-15}
          focalLength={0.85}
          speed1={0.5}
          speed2={0.35}
          bend1={0.5}
          bend2={0.4}
        />
      </div>
    ),
  },
  {
    id: "gradient-blinds",
    name: "Gradient Blinds",
    hint: "vertical slats",
    defaultColors: V3,
    render: ({ colors, interactive }) => (
      <div className="absolute inset-0 bg-black">
        <GradientBlinds
          gradientColors={colors}
          angle={20}
          noise={0.18}
          blindCount={26}
          blindMinWidth={36}
          mirrorGradient={false}
          spotlightRadius={0.5}
          spotlightSoftness={0.85}
          spotlightOpacity={0.9}
          distortAmount={0.12}
          shineDirection="right"
          mouseDampening={0.06}
          interactive={interactive}
        />
      </div>
    ),
  },
  {
    id: "linewaves",
    name: "Line Waves",
    hint: "warped lines",
    defaultColors: V3,
    render: ({ colors, interactive }) => (
      <div className="absolute inset-0 bg-black">
        <LineWaves
          color1={pick(colors, 0, V3[0]!)}
          color2={pick(colors, 1, V3[1]!)}
          color3={pick(colors, 2, V3[2]!)}
          speed={0.3}
          innerLineCount={32}
          outerLineCount={36}
          warpIntensity={1}
          rotation={-45}
          edgeFadeWidth={0}
          colorCycleSpeed={1}
          brightness={0.2}
          enableMouseInteraction={interactive}
        />
      </div>
    ),
  },
  {
    id: "particles",
    name: "Particles",
    hint: "starfield",
    defaultColors: V3,
    render: ({ colors, interactive }) => (
      <div className="absolute inset-0 bg-black">
        <Particles
          particleColors={colors}
          particleCount={260}
          particleSpread={11}
          speed={0.08}
          alphaParticles={true}
          particleBaseSize={70}
          sizeRandomness={1.0}
          moveParticlesOnHover={interactive}
          disableRotation={true}
        />
      </div>
    ),
  },
  {
    id: "dotgrid",
    name: "Dot Grid",
    hint: "reactive dots",
    defaultColors: V1,
    render: ({ colors }) => (
      <div className="absolute inset-0 bg-black">
        <DotGrid
          dotSize={3.5}
          gap={26}
          baseColor="rgba(120,140,170,0.32)"
          activeColor={pick(colors, 0, V1[0]!)}
          proximity={0}
        />
      </div>
    ),
  },
  {
    id: "dot-field",
    name: "Dot Field",
    hint: "gradient dots",
    defaultColors: V2,
    render: ({ colors }) => (
      <div className="absolute inset-0 bg-black">
        <DotField
          gradientFrom={pick(colors, 0, V2[0]!)}
          gradientTo={pick(colors, 1, V2[1]!)}
          glowColor={pick(colors, 1, V2[1]!)}
          dotRadius={1.5}
          dotSpacing={22}
          waveAmplitude={0.6}
          sparkle={true}
          glowRadius={120}
          cursorRadius={0}
          cursorForce={0}
        />
      </div>
    ),
  },
  {
    id: "lightning",
    name: "Lightning",
    hint: "electric arc",
    defaultColors: V1,
    render: ({ colors }) => (
      <div className="absolute inset-0 bg-black">
        <Lightning
          hue={hexToHueDeg(pick(colors, 0, V1[0]!))}
          speed={0.9}
          intensity={0.9}
          size={1.1}
        />
      </div>
    ),
  },
];

export const BACKGROUND_BY_ID: Record<string, Background> = Object.fromEntries(
  BACKGROUNDS.map((b) => [b.id, b]),
);

/** Resolve the colours a render function should use, given the canvas
 *  state's optional override and the background's defaults. */
export function resolveBackgroundColors(
  bg: Background,
  override: string[] | null,
): string[] {
  if (!override || override.length === 0) return bg.defaultColors;
  // Pad with defaults if the override has fewer slots than the
  // background expects (e.g. design carried over from a different bg).
  if (override.length < bg.defaultColors.length) {
    return bg.defaultColors.map((d, i) => override[i] ?? d);
  }
  return override.slice(0, bg.defaultColors.length);
}

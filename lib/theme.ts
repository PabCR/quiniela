/**
 * lib/theme.ts — JS-side design constants
 *
 * Carries values that CSS cannot deliver into Reanimated animations or
 * raw React Native StyleSheet objects.
 *
 * Token source: design_handoff_quiniela/prototype/tokens.css
 * See global.css for the @theme CSS tokens consumed by NativeWind utilities.
 */

import type { ViewStyle } from "react-native";

// ---------------------------------------------------------------------------
// TIMING
// ---------------------------------------------------------------------------

/** Fast micro-interactions (chips, icon state changes). */
export const DURATION_FAST = 140 as const;

/** Standard transitions (cards, panels, saves). */
export const DURATION_BASE = 220 as const;

// ---------------------------------------------------------------------------
// SPRING — react-native-reanimated
//
// Approximates cubic-bezier(0.34, 1.56, 0.64, 1) from tokens.css
// (--ease-spring). This is an overshoot / "qBounce" spring used for:
//   - Stepper value changes (Stepper component)
//   - The "Saved ✓" pill appearance
//
// Tuning notes:
//   damping: 12   — under-damped so it overshoots then settles
//   stiffness: 180 — snappy response matching the short cubic-bezier plateau
//   mass: 1        — neutral; increase to slow overall travel
//   overshootClamping: false — must be false to allow the bounce
//   restDisplacementThreshold / restSpeedThreshold: tight so the animation
//     snaps to final value cleanly (no lingering micro-jitter).
//
// If animation feels too aggressive, increase damping to 14–16.
// If it feels sluggish, decrease mass to 0.8 or increase stiffness to 200.
// ---------------------------------------------------------------------------

export const SPRING = {
  damping: 12,
  stiffness: 180,
  mass: 1,
  overshootClamping: false,
  restDisplacementThreshold: 0.01,
  restSpeedThreshold: 0.01,
} as const;

// ---------------------------------------------------------------------------
// TAP TARGET
// Minimum touch target size (44pt) — apply to interactive elements that are
// visually smaller (e.g. avatar rows, back buttons).
// ---------------------------------------------------------------------------

export const TAP_TARGET = 44 as const;

// ---------------------------------------------------------------------------
// TABULAR NUMERALS
//
// font-variant-numeric: tabular-nums is **web-only** in NativeWind v5 (the
// tabular-nums / tabular utility classes are no-ops on React Native).
// Apply this style object on every Text element displaying scores or points.
//
// Usage:
//   import { TABULAR_NUMS } from '@/lib/theme';
//   <Text style={TABULAR_NUMS}>2 – 1</Text>
//   // or merge with StyleSheet styles:
//   <Text style={[styles.score, TABULAR_NUMS]}>…</Text>
// ---------------------------------------------------------------------------

export const TABULAR_NUMS = {
  fontVariant: ["tabular-nums"],
} as const;

// ---------------------------------------------------------------------------
// SHADOW STYLE OBJECTS
//
// react-native-css-interop does not fully compile multi-layer box-shadow
// strings to native shadow props. Use these style objects directly on
// View/Pressable components that need the card or float shadow.
//
// Colour derived from tokens.css shadow base oklch(0.2 0.02 256) = #10161f
// (rgb 16, 22, 31).
//
// iOS: shadowColor + shadowOffset + shadowOpacity + shadowRadius.
//   Multi-layer effect is approximated by a single representative shadow.
// Android: elevation provides the system shadow; colour is OS-controlled.
//   Android does NOT support shadowColor; it is ignored.
//
// Usage:
//   import { SHADOW_CARD, SHADOW_FLOAT } from '@/lib/theme';
//   <View style={[styles.card, SHADOW_CARD]}>…</View>
// ---------------------------------------------------------------------------

/**
 * Approximates tokens.css --shadow-card:
 *   0 1px 2px oklch(0.2 0.02 256 / 0.05), 0 4px 16px oklch(0.2 0.02 256 / 0.06)
 * Dominant layer: 4px blur, 16px spread at 6% opacity.
 */
export const SHADOW_CARD: ViewStyle = {
  // iOS
  shadowColor: "#10161f",
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.08,
  shadowRadius: 8,
  // Android
  elevation: 2,
};

/**
 * Approximates tokens.css --shadow-float:
 *   0 4px 12px oklch(0.2 0.02 256 / 0.10), 0 12px 32px oklch(0.2 0.02 256 / 0.10)
 * Dominant layer: 12px blur, 32px spread at 10% opacity.
 */
export const SHADOW_FLOAT: ViewStyle = {
  // iOS
  shadowColor: "#10161f",
  shadowOffset: { width: 0, height: 12 },
  shadowOpacity: 0.12,
  shadowRadius: 16,
  // Android
  elevation: 8,
};

// ---------------------------------------------------------------------------
// FONT WEIGHT NOTE
//
// tokens.css --text-heading uses font-weight 650. React Native does not
// support fractional font weights (valid values: 100–900 in steps of 100).
// global.css maps --text-heading--font-weight to 700 (bold), which is the
// nearest step above 600 (semibold) to maintain visual hierarchy.
// Components that must land closer to semibold can apply font-weight: 600
// directly, understanding that no system font ships a distinct 650 face.
// ---------------------------------------------------------------------------

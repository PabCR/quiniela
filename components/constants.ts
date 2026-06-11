/* components/constants.ts — the ONE place non-class color constants live.
 *
 * NativeWind token classes (bg-*, text-*, border-*) cover every View/Text. Two
 * places can't consume a class and need a literal string:
 *   1. SVG stroke/fill colors (react-native-svg takes a color string prop).
 *   2. The modal-sheet backdrop overlay color.
 *
 * Every value here is the resolved sRGB hex of a global.css @theme token (the
 * hex equivalents are documented in global.css next to each oklch value). They
 * are NOT new colors — they mirror existing tokens so the design stays single-
 * sourced. If a token changes in global.css, update its twin here.
 *
 * Backdrop: prototype app.css uses oklch(0.2 0.02 256 / .42) for the sheet
 * overlay. lib/theme.ts documents the shadow base oklch(0.2 0.02 256) = rgb(16,
 * 22, 31), so the backdrop is rgba(16, 22, 31, 0.42).
 */

import type { TextStyle } from 'react-native';

import { TABULAR_NUMS } from '../lib/theme';

/** Sheet / modal backdrop — prototype oklch(0.2 0.02 256 / .42). */
export const BACKDROP_COLOR = 'rgba(16, 22, 31, 0.42)';

/**
 * Tabular numerals as a mutable TextStyle. lib/theme.ts exports TABULAR_NUMS
 * `as const` (fontVariant is readonly), which RN's TextStyle (mutable
 * FontVariant[]) rejects in a style array. This widened twin is the one
 * components apply: `style={[styles.x, TABULAR]}`. Same value, assignable type.
 */
export const TABULAR: TextStyle = { fontVariant: [...TABULAR_NUMS.fontVariant] };

/* ---- token hex twins for SVG color props (see global.css) ---- */
export const COLOR_BG = '#f5f7f9'; // --color-bg          (q-slate-25)
export const COLOR_TEXT = '#12181f'; // --color-text       (q-slate-900)
export const COLOR_TEXT_2 = '#4d555e'; // --color-text-2    (q-slate-600)
export const COLOR_TEXT_3 = '#6a7179'; // --color-text-3    (q-slate-500)
export const COLOR_TEXT_DISABLED = '#989fa7'; // --color-text-disabled (q-slate-400)
export const COLOR_ON_ACCENT = '#ffffff'; // --color-on-accent
export const COLOR_LIVE = '#ac3031'; // --color-live / --color-urgent (q-red-ink)
export const COLOR_EXACT = '#0a693c'; // --color-exact / --color-saved (q-green-ink)
export const COLOR_PARTIAL = '#875800'; // --color-partial (q-amber-ink)
export const COLOR_LOCKED = '#4d555e'; // --color-locked  (q-slate-600)
export const COLOR_SURFACE = '#ffffff'; // --color-surface

/**
 * The 22 avatar emojis from prototype/app/data.js (Q_EMOJIS) — the single
 * canonical set used by the onboarding profile picker AND the Me avatar editor.
 */
export const Q_EMOJIS = [
  '🦊', '🌺', '🎩', '🐱', '⚽', '🦋', '🌮', '🌟', '🎸', '🍓', '🐻',
  '🎨', '🚴', '🌙', '🥑', '🌵', '🐢', '🦜', '🍋', '🎺', '🐙', '🌶️',
] as const;

/* components/icons.tsx — react-native-svg ports of the prototype line icons.
 *
 * 1:1 with prototype/app/components.jsx (IcLock / IcBack / IcCheck / IcChev /
 * TabIcon). Strokes/fills use `currentColor` semantics: each icon takes a
 * `color` prop (default = the ink text token #12181f) so callers can recolor
 * by passing a token-resolved value. We never hardcode a *theme* color inside
 * the icon — callers pass the resolved color string; the default is the ink
 * accent which is also the text token.
 */

import Svg, { Path, Rect, Circle } from 'react-native-svg';

import { COLOR_ON_ACCENT, COLOR_TEXT, COLOR_TEXT_DISABLED } from './constants';

/** Ink accent / primary text token resolved to its hex (global.css --color-text). */
const INK = COLOR_TEXT;

export type IconProps = {
  size?: number;
  color?: string;
};

/** Padlock — frozen/locked pick glyph. */
export function IcLock({ size = 13, color = INK }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 14 14" fill="none">
      <Rect x={2.2} y={6.2} width={9.6} height={6.3} rx={2} fill={color} />
      <Path
        d="M4.6 6V4.6a2.4 2.4 0 0 1 4.8 0V6"
        stroke={color}
        strokeWidth={1.6}
        fill="none"
      />
    </Svg>
  );
}

/** Back chevron (detail header). */
export function IcBack({ size = 18, color = INK }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 18 18" fill="none">
      <Path
        d="M11.5 3.5L6 9l5.5 5.5"
        stroke={color}
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** Check mark — saved pill / advancer selected. */
export function IcCheck({ size = 10, color = COLOR_ON_ACCENT }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 10 10" fill="none">
      <Path
        d="M1.5 5.5l2.5 2.5 4.5-5"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** Right chevron — list-row affordance. */
export function IcChev({ size = 14, color = COLOR_TEXT_DISABLED }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 14 14" fill="none">
      <Path
        d="M5 3l4.5 4L5 11"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
      />
    </Svg>
  );
}

export type TabKind = 'matches' | 'board' | 'me';

/** The three tab-bar line icons (24px, 1.8 stroke). */
export function TabIcon({
  kind,
  size = 24,
  color = INK,
}: {
  kind: TabKind;
  size?: number;
  color?: string;
}) {
  const stroke = {
    stroke: color,
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    fill: 'none' as const,
  };
  if (kind === 'matches') {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <Rect x={3.5} y={4.5} width={17} height={16} rx={4} {...stroke} />
        <Path d="M3.5 9.5h17M8 3v3M16 3v3" {...stroke} />
      </Svg>
    );
  }
  if (kind === 'board') {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <Path d="M7 4.5h10v5a5 5 0 0 1-10 0v-5z" {...stroke} />
        <Path
          d="M7 6H4.5a2.5 2.5 0 0 0 2.6 3.4M17 6h2.5a2.5 2.5 0 0 1-2.6 3.4M12 14.5V18M8.5 20.5h7"
          {...stroke}
        />
      </Svg>
    );
  }
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={8.5} r={3.7} {...stroke} />
      <Path d="M4.8 20c1.3-3.2 4-5 7.2-5s5.9 1.8 7.2 5" {...stroke} />
    </Svg>
  );
}

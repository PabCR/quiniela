/* components/Chip.tsx — the small pill chips/tags from prototype .chip.
 *
 * Base (.chip): caption type, 650 weight, padding 5×11, pill radius, tabular
 * numerals. Variants mirror app.css exactly:
 *   exact       green fill / white text          (.chip--exact)
 *   exact-soft  white fill / green text          (.chip--exact-soft)
 *   outcome     amber fill / white text          (.chip--outcome)  [draw too]
 *   void        surface-3 fill / text-2          (.chip--void)
 *   postponed   amber-soft fill / amber text     (.chip--postponed)
 *   live        white fill / red text + shadow + red dot (.chip--live)
 *
 * Never color-alone: callers pair a chip with text/icon (the live chip carries
 * a dot + "Live", void chips carry an em-dash or label, etc.).
 */

import { Text, View, type TextStyle, type ViewStyle } from 'react-native';

import { SHADOW_CARD } from '../lib/theme';
import { TABULAR } from './constants';

export type ChipVariant =
  | 'exact'
  | 'exact-soft'
  | 'outcome'
  | 'void'
  | 'postponed'
  | 'live'
  | 'corrected';

const SURFACE: Record<ChipVariant, string> = {
  exact: 'bg-exact',
  'exact-soft': 'bg-surface',
  outcome: 'bg-partial',
  void: 'bg-surface-3',
  postponed: 'bg-partial-soft',
  live: 'bg-surface',
  corrected: 'bg-transparent',
};

const TEXT: Record<ChipVariant, string> = {
  exact: 'text-on-accent',
  'exact-soft': 'text-exact',
  outcome: 'text-on-accent',
  void: 'text-text-2',
  postponed: 'text-partial',
  live: 'text-live',
  corrected: 'text-partial',
};

export function Chip({
  variant,
  label,
  live,
  tabular,
  style,
}: {
  variant: ChipVariant;
  label: string;
  /** Render the red live dot before the label (live variant). */
  live?: boolean;
  /** Apply tabular numerals (scores / points inside the chip). */
  tabular?: boolean;
  style?: ViewStyle;
}) {
  // The "corrected" note is a bare colored caption, not a filled pill.
  if (variant === 'corrected') {
    return (
      <Text
        className="text-caption font-medium text-partial"
        // Layout-only subset (margins/alignment) — safe to apply to Text.
        style={style as TextStyle}
      >
        {label}
      </Text>
    );
  }

  return (
    <View
      className={
        'flex-row items-center gap-[5px] self-start rounded-pill px-[11px] py-[5px] ' +
        SURFACE[variant]
      }
      style={[variant === 'live' ? SHADOW_CARD : null, style]}
    >
      {live ? <View className="h-[7px] w-[7px] rounded-full bg-live" /> : null}
      <Text
        className={'text-caption font-semibold ' + TEXT[variant]}
        style={tabular ? TABULAR : undefined}
      >
        {label}
      </Text>
    </View>
  );
}

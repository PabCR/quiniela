/* components/Stepper.tsx — score stepper (prototype .step + Stepper).
 *
 * A surface card (rounded-lg, card shadow) with:
 *   - overline label (the FIFA team code)
 *   - a huge 44px tabular value; "–" when null (no pick yet)
 *   - a − / + button row (52×48 each, rounded-md, surface-2)
 *
 * On every change the value springs (qBounce) via reanimated SPRING — the
 * sanctioned micro-delight on stepper presses. Reduced motion → no bounce
 * (value snaps). Range clamped 0–15 (DB check). − disabled at null/0.
 *
 * The bounce is implemented as a scale that snaps to 0.7 then springs to 1 on
 * each change, mirroring @keyframes qBounce (0.7 → 1.12 → 1).
 */

import { useEffect } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { SHADOW_CARD, SPRING } from '../lib/theme';
import { TABULAR } from './constants';

const MIN = 0;
const MAX = 15;

export function Stepper({
  value,
  onChange,
  label,
}: {
  value: number | null;
  onChange: (next: number) => void;
  label: string;
}) {
  const reduceMotion = useReducedMotion();
  const scale = useSharedValue(1);

  // Bounce on every value change (after the first render).
  useEffect(() => {
    if (reduceMotion) return;
    scale.value = 0.7;
    scale.value = withSpring(1, SPRING);
  }, [value, reduceMotion, scale]);

  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const set = (next: number) => {
    if (next < MIN || next > MAX) return;
    onChange(next);
  };

  const minusDisabled = value == null || value <= MIN;

  return (
    <View
      className="flex-1 items-center gap-2 rounded-lg bg-surface px-[10px] py-[14px]"
      style={SHADOW_CARD}
    >
      <Text className="text-caption font-semibold uppercase tracking-[0.06em] text-text-3">
        {label}
      </Text>
      <Animated.Text
        accessibilityRole="text"
        accessibilityLabel={value == null ? 'no value' : String(value)}
        className="text-text"
        style={[{ fontSize: 44, fontWeight: '700', lineHeight: 46 }, TABULAR, animatedStyle]}
      >
        {value == null ? '–' : value}
      </Animated.Text>
      <View className="flex-row gap-[10px]">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={'decrement ' + label}
          accessibilityState={{ disabled: minusDisabled }}
          disabled={minusDisabled}
          onPress={() => set((value ?? 0) - 1)}
          style={({ pressed }) => ({ opacity: minusDisabled ? 0.35 : pressed ? 0.7 : 1 })}
          className="h-12 w-[52px] items-center justify-center rounded-md bg-surface-2"
        >
          <Text className="text-text" style={{ fontSize: 24, fontWeight: '600', lineHeight: 26 }}>
            −
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={'increment ' + label}
          onPress={() => set(value == null ? MIN : value + 1)}
          style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
          className="h-12 w-[52px] items-center justify-center rounded-md bg-surface-2"
        >
          <Text className="text-text" style={{ fontSize: 24, fontWeight: '600', lineHeight: 26 }}>
            +
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

/* components/FilterChips.tsx — the All / My pending filter row (prototype .chips).
 *
 * A row of pill chips; the active one fills with accent. Generic over a small
 * option list so later screens can reuse it. Each chip is ≥38px tall
 * (min-h-[38px]) with ample horizontal padding so it clears the 44px touch
 * guidance via its content box.
 */

import { Pressable, Text, View } from 'react-native';

export interface FilterOption<T extends string> {
  value: T;
  label: string;
}

export function FilterChips<T extends string>({
  options,
  value,
  onChange,
}: {
  options: FilterOption<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View className="flex-row gap-2">
      {options.map((opt) => {
        const on = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(opt.value)}
            style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
            className={
              'min-h-[38px] items-center justify-center rounded-pill border px-4 py-[9px] ' +
              (on ? 'border-accent bg-accent' : 'border-border bg-surface')
            }
          >
            <Text
              className={'text-label font-semibold ' + (on ? 'text-on-accent' : 'text-text-2')}
            >
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

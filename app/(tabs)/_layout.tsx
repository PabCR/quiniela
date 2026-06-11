/* app/(tabs)/_layout.tsx — the 3-tab shell with a custom tab bar.
 *
 * Tabs: Matches (index) / Leaderboard / Me. A custom tabBar renders 24px line
 * icons (components/icons → TabIcon) + caption labels (prototype .tabbar):
 *   active   = text-text ink     inactive = text-text-3
 *   bar      = translucent white (~0.95) + top hairline border-border
 *   Matches  = an 8px red pending dot with a 2px white ring when pending > 0
 *   bottom   = safe-area inset padding
 *
 * The PoolDataProvider is mounted at the ROOT layout (app/_layout.tsx) so this
 * group AND the app/match/[id] detail route (outside this group) share one data
 * context + realtime channel — documented there. This file only consumes it
 * (usePendingGames) to drive the badge dot.
 */

import { Tabs } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TabIcon, type TabKind } from '../../components/icons';
import { usePendingGames } from '../../lib/data';
import { useT } from '../../lib/providers';
import { COLOR_TEXT, COLOR_TEXT_3 } from '../../components/constants';

/* Minimal shape of the custom tabBar callback props we actually consume — the
 * navigation state's routes + index, and emit/navigate. Typed locally so we
 * don't depend on a deep @react-navigation/bottom-tabs import (not installed as
 * a top-level dep; expo-router vendors it). */
interface TabBarProps {
  state: { index: number; routes: { key: string; name: string }[] };
  navigation: {
    emit: (event: {
      type: 'tabPress';
      target: string;
      canPreventDefault: true;
    }) => { defaultPrevented: boolean };
    navigate: (name: string) => void;
  };
}

const TAB_META: { name: string; kind: TabKind; labelKey: 'tabMatches' | 'tabBoard' | 'tabMe' }[] = [
  { name: 'index', kind: 'matches', labelKey: 'tabMatches' },
  { name: 'leaderboard', kind: 'board', labelKey: 'tabBoard' },
  { name: 'me', kind: 'me', labelKey: 'tabMe' },
];

function CustomTabBar({ state, navigation }: TabBarProps) {
  const insets = useSafeAreaInsets();
  const t = useT();
  const pendingCount = usePendingGames().length;

  return (
    <View
      className="flex-row gap-1 border-t border-border px-[14px] pt-2"
      // ~0.95 white translucent bar (prototype .tabbar oklch(1 0 0 / .92)) —
      // an explicit rgba so it renders reliably without a NativeWind opacity
      // modifier on a CSS-var background.
      style={{ paddingBottom: 8 + insets.bottom, backgroundColor: 'rgba(255,255,255,0.95)' }}
    >
      {state.routes.map((route, index) => {
        const meta = TAB_META.find((m) => m.name === route.name);
        if (!meta) return null;
        const focused = state.index === index;
        const color = focused ? COLOR_TEXT : COLOR_TEXT_3;
        const showDot = meta.kind === 'matches' && pendingCount > 0;

        const onPress = () => {
          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });
          if (!focused && !event.defaultPrevented) {
            navigation.navigate(route.name);
          }
        };

        return (
          <Pressable
            key={route.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={t(meta.labelKey)}
            onPress={onPress}
            className="min-h-12 flex-1 items-center justify-center gap-[3px] rounded-md py-[6px]"
          >
            <View>
              <TabIcon kind={meta.kind} color={color} />
              {showDot ? (
                <View
                  className="absolute h-2 w-2 rounded-full border-2 border-surface bg-urgent"
                  style={{ top: -2, right: -6 }}
                  accessibilityLabel={t('pending_other', { n: pendingCount })}
                />
              ) : null}
            </View>
            <Text
              className="text-caption font-semibold"
              style={{ color }}
            >
              {t(meta.labelKey)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{ headerShown: false }}
      tabBar={(props) => <CustomTabBar {...props} />}
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="leaderboard" />
      <Tabs.Screen name="me" />
    </Tabs>
  );
}

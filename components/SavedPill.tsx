/* components/SavedPill.tsx — autosave confirmation (prototype SavedPill / .saved).
 *
 * The single sanctioned delight moment. Three states:
 *   idle    invisible (opacity 0, keeps layout height stable)
 *   saving  "Saving…" in text-3
 *   saved   a green check badge + "Saved" in the saved (green) token, the whole
 *           pill popping in via the qBounce SPRING (reanimated). Reduced motion
 *           → appears without the pop.
 *
 * Color is the --color-saved token (== exact green); the check badge sits in a
 * filled green circle (bg-saved) with a white tick (IcCheck).
 */

import { useEffect } from 'react';
import { Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import type { Translate } from '../lib/i18n';
import { SPRING } from '../lib/theme';
import { COLOR_ON_ACCENT } from './constants';
import { IcCheck } from './icons';

export type SaveState = 'idle' | 'saving' | 'saved';

export function SavedPill({ state, t }: { state: SaveState; t: Translate }) {
  const reduceMotion = useReducedMotion();
  const scale = useSharedValue(1);

  useEffect(() => {
    if (state === 'saved' && !reduceMotion) {
      scale.value = 0.7;
      scale.value = withSpring(1, SPRING);
    } else {
      scale.value = 1;
    }
  }, [state, reduceMotion, scale]);

  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Animated.View
      accessibilityRole="text"
      accessibilityLiveRegion="polite"
      className="min-h-6 flex-row items-center justify-center gap-[7px]"
      style={[{ opacity: state === 'idle' ? 0 : 1 }, animatedStyle]}
    >
      {state === 'saved' ? (
        <View className="h-[18px] w-[18px] items-center justify-center rounded-full bg-saved">
          <IcCheck size={10} color={COLOR_ON_ACCENT} />
        </View>
      ) : null}
      <Text
        className={
          'text-label font-semibold ' + (state === 'saving' ? 'text-text-3' : 'text-saved')
        }
      >
        {state === 'saving' ? t('saving') : t('saved')}
      </Text>
    </Animated.View>
  );
}

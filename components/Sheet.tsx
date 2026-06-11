/* components/Sheet.tsx — modal bottom sheet (prototype .ovl + .sheet).
 *
 * RN Modal + a reanimated slide-up panel:
 *   backdrop  rgba(16,22,31,.42)  (BACKDROP_COLOR — prototype oklch overlay)
 *   panel     surface, rounded-t-[28px] (radius-xl), bottom-anchored, padding
 *             22/20/40, qSlideUp entering (translateY 40 → 0, fade in) over the
 *             reanimated spring (lib/theme.ts SPRING). Reduced motion → no slide.
 *
 * Tapping the backdrop calls onClose. The panel stops propagation so a tap
 * inside it does not dismiss.
 */

import { Modal, Pressable, View, type ViewStyle } from 'react-native';
import Animated, {
  FadeIn,
  SlideInDown,
  useReducedMotion,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SHADOW_FLOAT } from '../lib/theme';
import { BACKDROP_COLOR } from './constants';

export function Sheet({
  visible,
  onClose,
  children,
  panelStyle,
}: {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  panelStyle?: ViewStyle;
}) {
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Animated.View
        entering={reduceMotion ? undefined : FadeIn.duration(220)}
        style={{ flex: 1, backgroundColor: BACKDROP_COLOR, justifyContent: 'flex-end' }}
      >
        {/* Backdrop tap closes. */}
        <Pressable
          style={{ position: 'absolute', inset: 0 }}
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={onClose}
        />
        <Animated.View
          entering={reduceMotion ? undefined : SlideInDown.springify().damping(18).stiffness(180)}
          className="w-full rounded-t-xl bg-surface px-5 pt-[22px]"
          style={[{ paddingBottom: 24 + insets.bottom }, SHADOW_FLOAT, panelStyle]}
        >
          {/* Inner stops the backdrop press from firing. */}
          <View>{children}</View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

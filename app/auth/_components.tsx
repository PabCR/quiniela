/* app/auth/_components.tsx — shared building blocks for the auth/onboarding
 * screens. Files prefixed with `_` are ignored by Expo Router (not routes).
 *
 * Visual language ported from the prototype Join screens (app.css):
 *   .join     — full-screen bg-bg, padding 70px 20px 30px
 *   .join-lang— segmented ES/EN toggle, top: 64px right: 16px
 *   .join h1  — 26px / 700, margin 26px top 6px bottom
 *   .join sub — text-body, text-2
 *   .cta      — full width, min-height 52px, pill, accent fill, on-accent text
 *   .ghostbtn — min-height 44px, 1.5px border-strong, pill, transparent
 *   .seg      — surface-2 track, pill, active = accent fill / on-accent text
 *
 * No hardcoded colors — every surface/text/border references a theme token.
 */

import { useReducedMotion } from 'react-native-reanimated';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useLang } from '../../lib/providers';
import { SHADOW_CARD, TAP_TARGET } from '../../lib/theme';
import type { Lang } from '../../lib/types';

/* ---- ES/EN segmented toggle (top-right of every auth screen) ---- */

export function LangSegment() {
  const { lang, setLang } = useLang();
  const options: Lang[] = ['es', 'en'];
  return (
    <View
      className="flex-row rounded-pill bg-surface-2 p-[3px]"
      accessibilityRole="radiogroup"
    >
      {options.map((opt) => {
        const on = lang === opt;
        return (
          <Pressable
            key={opt}
            onPress={() => setLang(opt)}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            className={
              'min-h-9 items-center justify-center rounded-pill px-4 ' +
              (on ? 'bg-accent' : 'bg-transparent')
            }
          >
            <Text
              className={
                'text-label font-semibold ' + (on ? 'text-on-accent' : 'text-text-2')
              }
            >
              {opt.toUpperCase()}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/* ---- Screen scaffold: bg-bg, 70px top pad (+ safe area), lang toggle top-right ---- */

export function AuthScreen({
  children,
  scroll = true,
}: {
  children: React.ReactNode;
  scroll?: boolean;
}) {
  const insets = useSafeAreaInsets();
  // Prototype uses 70px top padding from the screen top; add the device inset so
  // content clears the notch on hardware.
  const topPad = 70 + insets.top * 0.5;

  const inner = (
    <>
      <View className="absolute right-4 z-10" style={{ top: 64 + insets.top * 0.5 }}>
        <LangSegment />
      </View>
      {children}
    </>
  );

  if (!scroll) {
    return (
      <View
        className="flex-1 bg-bg px-5"
        style={{ paddingTop: topPad, paddingBottom: 30 + insets.bottom }}
      >
        {inner}
      </View>
    );
  }

  return (
    <ScrollView
      className="flex-1 bg-bg"
      contentContainerStyle={{
        paddingTop: topPad,
        paddingBottom: 30 + insets.bottom,
        paddingHorizontal: 20,
      }}
      keyboardShouldPersistTaps="handled"
    >
      {inner}
    </ScrollView>
  );
}

/* ---- Title + subtitle block (.join h1 + .join p.sub) ---- */

export function AuthHeader({ title, sub }: { title: string; sub?: string }) {
  return (
    <View className="mb-[22px] mt-[26px]">
      <Text className="text-text" style={{ fontSize: 26, fontWeight: '700', lineHeight: 31 }}>
        {title}
      </Text>
      {sub ? <Text className="mt-1.5 text-body text-text-2">{sub}</Text> : null}
    </View>
  );
}

/* ---- Primary CTA (.cta) — accent pill, white label, disabled = .4 opacity ---- */

export function CtaButton({
  label,
  onPress,
  disabled,
  loading,
  style,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
}) {
  const reduceMotion = useReducedMotion();
  const isDisabled = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      style={({ pressed }) => [
        {
          opacity: isDisabled ? 0.4 : pressed && !reduceMotion ? 0.85 : 1,
        },
        style,
      ]}
      className="min-h-[52px] w-full flex-row items-center justify-center rounded-pill bg-accent px-4"
    >
      {loading ? (
        <ActivityIndicator color="#ffffff" />
      ) : (
        <Text className="text-on-accent" style={{ fontSize: 17, fontWeight: '600' }}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

/* ---- Ghost / secondary button (.ghostbtn) ---- */

export function GhostButton({
  label,
  onPress,
  borderless = false,
}: {
  label: string;
  onPress: () => void;
  borderless?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
      className={
        'w-full flex-row items-center justify-center rounded-pill px-[18px] ' +
        (borderless ? 'border-0' : 'border-[1.5px] border-border-strong')
      }
    >
      <View style={{ minHeight: TAP_TARGET, justifyContent: 'center' }}>
        <Text className="text-text" style={{ fontSize: 14, fontWeight: '600' }}>
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

/* ---- Inline error line (never color-alone: prefixed with a warning glyph) ---- */

export function InlineError({ message }: { message: string }) {
  if (!message) return null;
  return (
    <Text
      className="mt-2 text-label text-live"
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
    >
      {'⚠ ' + message}
    </Text>
  );
}

/* ---- Card wrapper (.join-name style surface) for input groupings ---- */

export function Card({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
}) {
  return (
    <View
      className="rounded-lg bg-surface p-4"
      style={[SHADOW_CARD, style]}
    >
      {children}
    </View>
  );
}

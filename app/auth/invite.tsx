/* app/auth/invite.tsx — "the key to the house".
 *
 * Step 1 of onboarding. A single large, centered code input (unambiguous
 * alphabet, auto-uppercase). The CTA validates the code via the anon-callable
 * RPC check_invite_code. Wrong → inline error + a brief shake (skipped under
 * reduced motion). Valid → persist the code for the profile step and continue
 * to the email screen.
 */

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { TextInput, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import {
  AuthHeader,
  AuthScreen,
  CtaButton,
  InlineError,
} from './_components';
import { useT } from '../../lib/providers';
import { normalizeInviteCode, setPendingInviteCode } from '../../lib/onboarding';
import { supabase } from '../../lib/supabase';
import { DURATION_FAST } from '../../lib/theme';

export default function InviteScreen() {
  const t = useT();
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const { codeError } = useLocalSearchParams<{ codeError?: string }>();

  const [code, setCode] = useState('');
  // Pre-set when bounced back from the profile step because the code was rotated.
  const [error, setError] = useState(() => (codeError ? t('inviteErrorWrong') : ''));
  const [checking, setChecking] = useState(false);

  const shakeX = useSharedValue(0);
  const shakeStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shakeX.value }],
  }));
  const triggerShake = () => {
    if (reduceMotion) return;
    shakeX.set(
      withSequence(
        withTiming(-8, { duration: DURATION_FAST / 3 }),
        withTiming(8, { duration: DURATION_FAST / 3 }),
        withTiming(-5, { duration: DURATION_FAST / 3 }),
        withTiming(0, { duration: DURATION_FAST / 3 }),
      ),
    );
  };

  const inputRef = useRef<TextInput>(null);

  const onContinue = async () => {
    const normalized = normalizeInviteCode(code);
    if (!normalized) {
      setError(t('inviteErrorEmpty'));
      triggerShake();
      return;
    }
    setError('');
    setChecking(true);
    try {
      const { data, error: rpcError } = await supabase.rpc('check_invite_code', {
        p_code: normalized,
      });
      if (rpcError || data !== true) {
        setError(t('inviteErrorWrong'));
        triggerShake();
        return;
      }
      await setPendingInviteCode(normalized);
      router.push('/auth/email');
    } catch {
      setError(t('inviteErrorWrong'));
      triggerShake();
    } finally {
      setChecking(false);
    }
  };

  return (
    <AuthScreen>
      <AuthHeader title={t('inviteTitle')} sub={t('inviteSub')} />

      <Animated.View style={shakeStyle}>
        <TextInput
          ref={inputRef}
          value={code}
          onChangeText={(v) => {
            setCode(v.toUpperCase());
            if (error) setError('');
          }}
          onSubmitEditing={onContinue}
          autoCapitalize="characters"
          autoCorrect={false}
          autoComplete="off"
          autoFocus
          maxLength={12}
          returnKeyType="go"
          placeholder={t('inviteCodePlaceholder')}
          placeholderTextColor="#989fa7"
          accessibilityLabel={t('inviteCodeLabel')}
          className="rounded-md border border-border bg-surface text-text"
          style={{
            height: 64,
            textAlign: 'center',
            fontSize: 28,
            fontWeight: '700',
            letterSpacing: 6,
          }}
        />
      </Animated.View>

      <InlineError message={error} />

      <View className="mt-6">
        <CtaButton
          label={t('inviteContinue')}
          onPress={onContinue}
          loading={checking}
          disabled={!code.trim()}
        />
      </View>
    </AuthScreen>
  );
}

/* app/auth/code.tsx — 6-digit OTP entry (step 3).
 *
 * Renders six tabular boxes backed by a single hidden TextInput (the most
 * reliable RN pattern for OTP — system autofill targets one field, paste fills
 * all six). verifyOtp({ type: 'email' }) on a full code; wrong/expired → inline
 * error + a resend affordance with a cooldown timer.
 *
 * Post-verify routing (brief §7): a returning user who already holds a
 * membership skips straight to the tabs; a new user (no membership) continues to
 * the profile/join step. We read membership via a fresh fetch here rather than
 * waiting for the provider so navigation is deterministic right after verify.
 */

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import {
  AuthHeader,
  AuthScreen,
  CtaButton,
  GhostButton,
  InlineError,
} from '../../components/auth';
import { useSession, useT } from '../../lib/providers';
import { supabase } from '../../lib/supabase';

const CODE_LENGTH = 6;
const RESEND_COOLDOWN = 30; // seconds

export default function CodeScreen() {
  const t = useT();
  const router = useRouter();
  const { refresh } = useSession();
  const { email } = useLocalSearchParams<{ email: string }>();

  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN);

  const hiddenRef = useRef<TextInput>(null);

  // Resend cooldown ticker.
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  const doVerify = async (token: string) => {
    if (!email) {
      setError(t('otpErrorWrong'));
      return;
    }
    setVerifying(true);
    setError('');
    try {
      const { data, error: verifyError } = await supabase.auth.verifyOtp({
        email,
        token,
        type: 'email',
      });
      if (verifyError || !data.session) {
        setError(t('otpErrorWrong'));
        setCode('');
        return;
      }

      // Membership check straight after verify (brief §7): existing member →
      // tabs; otherwise → profile/join. Query directly for a deterministic jump.
      const { data: membership } = await supabase
        .from('memberships')
        .select('pool_id')
        .eq('user_id', data.session.user.id)
        .eq('hidden', false)
        .limit(1)
        .maybeSingle();

      // Sync the provider so the gate agrees with where we navigate.
      await refresh();

      if (membership) {
        router.replace('/(tabs)');
      } else {
        router.replace('/auth/profile');
      }
    } catch {
      setError(t('otpErrorWrong'));
      setCode('');
    } finally {
      setVerifying(false);
    }
  };

  const onChange = (raw: string) => {
    const digits = raw.replace(/\D/g, '').slice(0, CODE_LENGTH);
    setCode(digits);
    if (error) setError('');
    if (digits.length === CODE_LENGTH) {
      void doVerify(digits);
    }
  };

  const onResend = async () => {
    if (cooldown > 0 || !email) return;
    setError('');
    setCode('');
    await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true },
    });
    setCooldown(RESEND_COOLDOWN);
  };

  const boxes = Array.from({ length: CODE_LENGTH }, (_, i) => code[i] ?? '');

  return (
    <AuthScreen>
      <AuthHeader
        title={t('otpTitle')}
        sub={t('otpSub', { email: email ?? '' })}
      />

      {/* Visible boxes overlay a single hidden input. */}
      <Pressable
        onPress={() => hiddenRef.current?.focus()}
        className="flex-row justify-between"
        accessibilityLabel={t('otpLabel')}
      >
        {boxes.map((digit, i) => {
          const focused = i === Math.min(code.length, CODE_LENGTH - 1);
          return (
            <View
              key={i}
              className={
                'items-center justify-center rounded-md border bg-surface ' +
                (focused && !digit ? 'border-accent' : 'border-border')
              }
              style={{ width: 48, height: 60 }}
            >
              <Text
                className="text-text"
                style={{
                  fontSize: 26,
                  fontWeight: '700',
                  fontVariant: ['tabular-nums'],
                }}
              >
                {digit}
              </Text>
            </View>
          );
        })}
      </Pressable>

      <TextInput
        ref={hiddenRef}
        value={code}
        onChangeText={onChange}
        keyboardType="number-pad"
        inputMode="numeric"
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        autoFocus
        maxLength={CODE_LENGTH}
        // Off-screen but focusable; opacity 0 keeps autofill working.
        style={{ position: 'absolute', opacity: 0, height: 1, width: 1 }}
      />

      <InlineError message={error} />

      <View className="mt-6">
        <CtaButton
          label={verifying ? t('otpVerifying') : t('otpContinue')}
          onPress={() => doVerify(code)}
          loading={verifying}
          disabled={code.length !== CODE_LENGTH}
        />
      </View>

      <View className="mt-4 items-center">
        {cooldown > 0 ? (
          <Text className="text-label text-text-3">
            {t('otpResendIn', { t: `${cooldown}s` })}
          </Text>
        ) : (
          <GhostButton label={t('otpResend')} onPress={onResend} borderless />
        )}
      </View>

      <View className="mt-1">
        <GhostButton
          label={t('otpChangeEmail')}
          onPress={() => router.replace('/auth/email')}
          borderless
        />
      </View>
    </AuthScreen>
  );
}

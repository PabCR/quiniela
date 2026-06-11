/* app/auth/email.tsx — email entry (step 2).
 *
 * signInWithOtp with shouldCreateUser: true (self-serve: creates the account if
 * new). On success the email is passed to the code screen as a route param so
 * verifyOtp can reference it. detectSessionInUrl is false so no magic-link
 * redirect is involved — the user types the 6-digit code from the email.
 */

import { useRouter } from 'expo-router';
import { useState } from 'react';
import { TextInput, View } from 'react-native';

import {
  AuthHeader,
  AuthScreen,
  CtaButton,
  GhostButton,
  InlineError,
} from './_components';
import { useT } from '../../lib/providers';
import { supabase } from '../../lib/supabase';
import { COLOR_TEXT_DISABLED } from '../../components/constants';

// Pragmatic email shape check — server is the real validator.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function EmailScreen() {
  const t = useT();
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);

  const onContinue = async () => {
    const trimmed = email.trim();
    if (!EMAIL_RE.test(trimmed)) {
      setError(t('emailErrorInvalid'));
      return;
    }
    setError('');
    setSending(true);
    try {
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email: trimmed,
        options: { shouldCreateUser: true },
      });
      if (otpError) {
        setError(t('emailErrorInvalid'));
        return;
      }
      router.push({ pathname: '/auth/code', params: { email: trimmed } });
    } catch {
      setError(t('emailErrorInvalid'));
    } finally {
      setSending(false);
    }
  };

  return (
    <AuthScreen>
      <AuthHeader title={t('emailTitle')} sub={t('emailSub')} />

      <TextInput
        value={email}
        onChangeText={(v) => {
          setEmail(v);
          if (error) setError('');
        }}
        onSubmitEditing={onContinue}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        keyboardType="email-address"
        inputMode="email"
        autoFocus
        returnKeyType="go"
        placeholder={t('emailPlaceholder')}
        placeholderTextColor={COLOR_TEXT_DISABLED}
        accessibilityLabel={t('emailLabel')}
        className="rounded-md border border-border bg-surface px-4 text-text"
        style={{ height: 56, fontSize: 17 }}
      />

      <InlineError message={error} />

      <View className="mt-6">
        <CtaButton
          label={sending ? t('emailSending') : t('emailContinue')}
          onPress={onContinue}
          loading={sending}
          disabled={!email.trim()}
        />
      </View>

      <View className="mt-2.5">
        <GhostButton label={t('back')} onPress={() => router.back()} borderless />
      </View>
    </AuthScreen>
  );
}

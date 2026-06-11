/* app/auth/profile.tsx — display name + emoji avatar (step 4, new members only).
 *
 * Reuses the prototype Join visual language: name input replaces the name grid,
 * then a 5-column emoji grid (the 22 Q_EMOJIS). Selected emoji = accent border +
 * accent-soft fill. Primary CTA "Let's go / Vamos" + a quiet skip for the emoji.
 *
 * Submit calls join_pool(invite_code, name, emoji) with the code carried over
 * from the invite step. Error handling per brief §7:
 *   23505 duplicate name → inline error with a "name 2" suggestion
 *   22023 bad/rotated code → bounce back to the invite screen with an error
 * Success → clear the pending code, refresh the provider, go to the tabs.
 *
 * Guard: if no pending invite code is found (e.g. the user re-authed on a fresh
 * install), we send them back to the invite screen rather than calling join_pool
 * with nothing.
 */

import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import {
  AuthHeader,
  AuthScreen,
  CtaButton,
  GhostButton,
  InlineError,
} from './_components';
import { useSession, useT } from '../../lib/providers';
import {
  clearPendingInviteCode,
  getPendingInviteCode,
} from '../../lib/onboarding';
import { supabase } from '../../lib/supabase';
// The 22 avatar emojis from prototype/app/data.js (Q_EMOJIS), canonical set.
import { Q_EMOJIS, COLOR_TEXT_DISABLED } from '../../components/constants';

interface PgError {
  code?: string;
  message?: string;
}

export default function ProfileScreen() {
  const t = useT();
  const router = useRouter();
  const { refresh } = useSession();

  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [joining, setJoining] = useState(false);
  const [inviteCode, setInviteCode] = useState<string | null>(null);

  // Recover the invite code stashed on the invite step.
  useEffect(() => {
    let active = true;
    getPendingInviteCode().then((c) => {
      if (!active) return;
      if (!c) {
        // No code in flight — return to the invite gate to revalidate.
        router.replace('/auth/invite');
        return;
      }
      setInviteCode(c);
    });
    return () => {
      active = false;
    };
  }, [router]);

  const submit = async (withEmoji: string | null) => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t('profileNameEmpty'));
      return;
    }
    if (!inviteCode) {
      router.replace('/auth/invite');
      return;
    }
    setError('');
    setJoining(true);
    try {
      const { error: rpcError } = await supabase.rpc('join_pool', {
        p_invite_code: inviteCode,
        p_display_name: trimmed,
        p_emoji: withEmoji,
      });

      if (rpcError) {
        const e = rpcError as PgError;
        if (e.code === '23505') {
          // Duplicate display name — suggest "name 2".
          setError(t('profileNameTaken', { suggestion: `${trimmed} 2` }));
          return;
        }
        if (e.code === '22023') {
          // Bad / rotated invite code — back to the invite gate with an error.
          await clearPendingInviteCode();
          router.replace({
            pathname: '/auth/invite',
            params: { codeError: '1' },
          });
          return;
        }
        // Any other failure: surface the duplicate-name copy as a safe default
        // is wrong; show the generic taken/empty path instead.
        setError(t('profileNameTaken', { suggestion: `${trimmed} 2` }));
        return;
      }

      await clearPendingInviteCode();
      await refresh();
      router.replace('/(tabs)');
    } catch {
      setError(t('profileNameTaken', { suggestion: `${name.trim()} 2` }));
    } finally {
      setJoining(false);
    }
  };

  return (
    <AuthScreen>
      <AuthHeader title={t('profileSetupTitle')} sub={t('profileSetupSub')} />

      <TextInput
        value={name}
        onChangeText={(v) => {
          setName(v);
          if (error) setError('');
        }}
        autoCapitalize="words"
        autoCorrect={false}
        autoComplete="name"
        autoFocus
        returnKeyType="done"
        maxLength={40}
        placeholder={t('profileNamePlaceholder')}
        placeholderTextColor={COLOR_TEXT_DISABLED}
        accessibilityLabel={t('profileNameLabel')}
        className="rounded-md border border-border bg-surface px-4 text-text"
        style={{ height: 56, fontSize: 17 }}
      />

      <InlineError message={error} />

      {/* 5-column emoji grid. Selected = accent border + accent-soft fill. */}
      <Text className="mb-3 mt-6 text-label font-semibold text-text-2">
        {t('joinAvatarTitle')}
      </Text>
      <View className="flex-row flex-wrap" style={{ marginHorizontal: -5 }}>
        {Q_EMOJIS.map((e) => {
          const on = emoji === e;
          return (
            <View key={e} style={{ width: '20%', padding: 5 }}>
              <Pressable
                onPress={() => setEmoji(on ? null : e)}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`Avatar ${e}`}
                className={
                  'aspect-square items-center justify-center rounded-md border-2 bg-surface ' +
                  (on ? 'border-accent bg-accent-soft' : 'border-transparent')
                }
                style={{ minHeight: 44 }}
              >
                <Text style={{ fontSize: 26 }}>{e}</Text>
              </Pressable>
            </View>
          );
        })}
      </View>

      <View className="mt-6">
        <CtaButton
          label={joining ? t('profileJoining') : t('joinGo')}
          onPress={() => submit(emoji)}
          loading={joining}
          disabled={!name.trim()}
        />
      </View>

      {emoji ? (
        <View className="mt-2.5">
          <GhostButton
            label={t('skip')}
            onPress={() => submit(null)}
            borderless
          />
        </View>
      ) : null}
    </AuthScreen>
  );
}

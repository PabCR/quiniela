/* app/admin/members.tsx — Admin: Members (brief §9 §7.6, README §7).
 *
 * Invite code section:
 *   The pool's invite_code in a mono-ish code well (bg-surface-2, rounded-sm).
 *   Copy button (expo-clipboard; flips to t('copied') for ~1.5 s).
 *   Rotate button → confirm Sheet ("rotating invalidates the old code") →
 *     supabase.rpc('rotate_invite_code', { p_pool_id }) → shows new code.
 *
 * Member list:
 *   All members (including hidden ones visible to admin).
 *   Avatar, name, role sub-label + hidden state indicator.
 *   Soft-hide/unhide toggle per member → confirm Sheet for hiding
 *   (member disappears from leaderboard, data retained).
 *
 * Add members:
 *   Quiet explanatory note — members join themselves with the invite code.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar, IcBack, Sheet } from '../../components';
import { COLOR_TEXT } from '../../components/constants';
import { useT } from '../../lib/providers';
import { usePool } from '../../lib/data';
import { SHADOW_CARD } from '../../lib/theme';
import { supabase } from '../../lib/supabase';
import type { Translate } from '../../lib/i18n';

/* ---- Extended member shape including hidden rows (admin can see all) ---- */
interface AdminMember {
  user_id: string;
  role: 'admin' | 'player';
  hidden: boolean;
  name: string;
  emoji: string | null;
}

export default function AdminMembersScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const t = useT();
  const pool = usePool();

  // Invite code: seeded from pool, overridden by rotate
  const poolInviteCode = pool?.invite_code ?? '';
  const [rotatedCode, setRotatedCode] = useState<string | null>(null);
  const displayCode = rotatedCode ?? poolInviteCode;

  const [copied, setCopied] = useState(false);
  const [rotateSheet, setRotateSheet] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [rotateError, setRotateError] = useState<string | null>(null);

  // Members — load ALL including hidden
  const [members, setMembers] = useState<AdminMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const poolId = pool?.id;

  // Hide confirm sheet
  const [hideTarget, setHideTarget] = useState<AdminMember | null>(null);
  const [hiding, setHiding] = useState(false);
  const [hideError, setHideError] = useState<string | null>(null);

  // Load all members (including hidden) when poolId is known
  useEffect(() => {
    if (!poolId) return;
    let active = true;

    supabase
      .from('memberships')
      .select('user_id, role, hidden, profiles!inner(name, emoji)')
      .eq('pool_id', poolId)
      .then(({ data, error }) => {
        if (!active) return;
        if (error || !data) {
          setMembersLoading(false);
          return;
        }
        const rows: AdminMember[] = data.map((m: {
          user_id: string;
          role: 'admin' | 'player';
          hidden: boolean;
          profiles: { name: string; emoji: string | null } | { name: string; emoji: string | null }[];
        }) => {
          const prof = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles;
          return {
            user_id: m.user_id,
            role: m.role,
            hidden: m.hidden,
            name: prof?.name ?? '',
            emoji: prof?.emoji ?? null,
          };
        });
        rows.sort((a, b) => {
          if (a.role !== b.role) return a.role === 'admin' ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
        setMembers(rows);
        setMembersLoading(false);
      });

    return () => {
      active = false;
    };
  }, [poolId]);

  // Copy invite code
  const handleCopy = useCallback(async () => {
    if (!displayCode) return;
    await Clipboard.setStringAsync(displayCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [displayCode]);

  // Rotate invite code
  const handleRotate = useCallback(async () => {
    if (!poolId) return;
    setRotating(true);
    setRotateError(null);
    const { data, error } = await supabase.rpc('rotate_invite_code', {
      p_pool_id: poolId,
    });
    if (error) {
      const code = (error as { code?: string }).code;
      setRotateError(code === '42501' ? 'admin only' : error.message);
      setRotating(false);
      return;
    }
    if (typeof data === 'string') setRotatedCode(data);
    setRotating(false);
    setRotateSheet(false);
  }, [poolId]);

  // Toggle member hidden — unhide directly, hide via confirm Sheet
  const handleHideToggle = useCallback((member: AdminMember) => {
    if (!member.hidden) {
      setHideTarget(member);
      return;
    }
    // Unhide directly (no confirm needed)
    if (!poolId) return;
    setHiding(true);
    setHideError(null);
    supabase.rpc('set_member_hidden', {
      p_pool_id: poolId,
      p_user_id: member.user_id,
      p_hidden: false,
    }).then(({ error }) => {
      if (error) {
        const code = (error as { code?: string }).code;
        setHideError(code === '42501' ? 'admin only' : error.message);
      } else {
        setMembers((prev) =>
          prev.map((m) =>
            m.user_id === member.user_id ? { ...m, hidden: false } : m,
          ),
        );
      }
      setHiding(false);
    });
  }, [poolId]);

  const confirmHide = useCallback(async () => {
    if (!poolId || !hideTarget) return;
    setHiding(true);
    setHideError(null);
    const { error } = await supabase.rpc('set_member_hidden', {
      p_pool_id: poolId,
      p_user_id: hideTarget.user_id,
      p_hidden: true,
    });
    if (error) {
      const code = (error as { code?: string }).code;
      setHideError(code === '42501' ? 'admin only' : error.message);
    } else {
      setMembers((prev) =>
        prev.map((m) =>
          m.user_id === hideTarget.user_id ? { ...m, hidden: true } : m,
        ),
      );
    }
    setHiding(false);
    setHideTarget(null);
  }, [poolId, hideTarget]);

  return (
    <View className="flex-1 bg-bg">
      {/* Header */}
      <View
        className="flex-row items-center gap-2 px-3"
        style={{ paddingTop: 12 + insets.top }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('back')}
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/me'))}
          style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }, SHADOW_CARD]}
          className="h-11 w-11 items-center justify-center rounded-full bg-surface"
        >
          <IcBack color={COLOR_TEXT} />
        </Pressable>
        <Text className="flex-1 text-center text-heading font-bold text-text">
          {t('membersTitle')}
        </Text>
        <View className="w-11" />
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 16,
          paddingBottom: 40 + insets.bottom,
          gap: 14,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Invite code section ── */}
        <View className="overflow-hidden rounded-lg bg-surface" style={SHADOW_CARD}>
          <Text className="px-4 pb-1 pt-[14px] text-label font-semibold uppercase tracking-[0.06em] text-text-3">
            {t('inviteCode')}
          </Text>

          {/* Code well + action buttons */}
          <View className="flex-row items-center gap-2 px-4 pb-4 pt-[6px]">
            {/* Mono code well */}
            <View className="min-w-0 flex-1 rounded-sm bg-surface-2 px-[10px] py-[9px]">
              <Text
                className="text-caption font-medium text-text-2"
                numberOfLines={1}
                style={{ fontVariant: ['tabular-nums'], letterSpacing: 1.5 }}
              >
                {displayCode || '……'}
              </Text>
            </View>

            {/* Copy button */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={copied ? t('copied') : t('copy')}
              onPress={handleCopy}
              style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
              className="min-h-11 items-center justify-center rounded-lg border border-border-strong px-3 py-2"
            >
              <Text className="text-label font-semibold text-text">
                {copied ? t('copied') : t('copy')}
              </Text>
            </Pressable>

            {/* Rotate button */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('rotateCode')}
              onPress={() => setRotateSheet(true)}
              style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
              className="min-h-11 items-center justify-center rounded-lg border border-border-strong px-3 py-2"
            >
              <Text className="text-label font-semibold text-text">
                {t('rotateCode')}
              </Text>
            </Pressable>
          </View>

          {rotateError ? (
            <Text
              className="px-4 pb-3 text-caption text-live"
              accessibilityRole="alert"
            >
              {'⚠ ' + rotateError}
            </Text>
          ) : null}
        </View>

        {/* ── Members section ── */}
        <View className="overflow-hidden rounded-lg bg-surface" style={SHADOW_CARD}>
          <Text className="px-4 pb-1 pt-[14px] text-label font-semibold uppercase tracking-[0.06em] text-text-3">
            {members.length > 0
              ? t('membersCount', { n: members.length })
              : t('membersTitle')}
          </Text>

          {membersLoading ? (
            <View className="items-center py-6">
              <ActivityIndicator color={COLOR_TEXT} />
            </View>
          ) : (
            members.map((member, i) => (
              <MemberRow
                key={member.user_id}
                member={member}
                divider={i > 0}
                hiding={hiding}
                onToggleHide={() => handleHideToggle(member)}
                t={t}
              />
            ))
          )}

          {hideError ? (
            <Text
              className="px-4 pb-3 text-caption text-live"
              accessibilityRole="alert"
            >
              {'⚠ ' + hideError}
            </Text>
          ) : null}
        </View>

        {/* ── Add members explanatory note ── */}
        <View className="overflow-hidden rounded-lg bg-surface px-4 py-4" style={SHADOW_CARD}>
          <Text className="text-label font-semibold uppercase tracking-[0.06em] text-text-3">
            {t('memberAdd')}
          </Text>
          <Text className="mt-2 text-body text-text-2">
            {t('inviteSub')}
          </Text>
          <Text className="mt-1 text-caption text-text-3">
            {t('inviteCode') + ': '}
            <Text style={{ fontVariant: ['tabular-nums'], letterSpacing: 1 }}>
              {displayCode || '……'}
            </Text>
          </Text>
        </View>
      </ScrollView>

      {/* ── Rotate confirm Sheet ── */}
      <Sheet visible={rotateSheet} onClose={() => setRotateSheet(false)}>
        <Text className="text-heading font-bold text-text" style={{ marginBottom: 6 }}>
          {t('rotateConfirm')}
        </Text>
        <Text className="text-body text-text-2" style={{ marginBottom: 16 }}>
          {t('rotateBody')}
        </Text>
        <View className="flex-row gap-[10px]">
          <Pressable
            accessibilityRole="button"
            onPress={() => setRotateSheet(false)}
            style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
            className="min-h-[52px] flex-1 items-center justify-center rounded-xl border border-border-strong bg-surface"
          >
            <Text className="text-body font-semibold text-text">{t('cancel')}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={handleRotate}
            accessibilityState={{ disabled: rotating }}
            disabled={rotating}
            style={({ pressed }) => ({
              opacity: rotating ? 0.4 : pressed ? 0.85 : 1,
            })}
            className="min-h-[52px] flex-1 items-center justify-center rounded-xl bg-accent"
          >
            <Text className="text-body font-semibold text-on-accent">
              {rotating ? '…' : t('confirm')}
            </Text>
          </Pressable>
        </View>
      </Sheet>

      {/* ── Hide confirm Sheet ── */}
      <Sheet
        visible={hideTarget != null}
        onClose={() => setHideTarget(null)}
      >
        <Text className="text-heading font-bold text-text" style={{ marginBottom: 6 }}>
          {t('memberHide') + (hideTarget ? ' — ' + hideTarget.name : '')}
        </Text>
        <Text className="text-body text-text-2" style={{ marginBottom: 16 }}>
          {t('releaseBody', { name: hideTarget?.name ?? '' })}
        </Text>
        <View className="flex-row gap-[10px]">
          <Pressable
            accessibilityRole="button"
            onPress={() => setHideTarget(null)}
            style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
            className="min-h-[52px] flex-1 items-center justify-center rounded-xl border border-border-strong bg-surface"
          >
            <Text className="text-body font-semibold text-text">{t('cancel')}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={confirmHide}
            accessibilityState={{ disabled: hiding }}
            disabled={hiding}
            style={({ pressed }) => ({
              opacity: hiding ? 0.4 : pressed ? 0.85 : 1,
            })}
            className="min-h-[52px] flex-1 items-center justify-center rounded-xl bg-accent"
          >
            <Text className="text-body font-semibold text-on-accent">
              {hiding ? '…' : t('confirm')}
            </Text>
          </Pressable>
        </View>
      </Sheet>
    </View>
  );
}

/* ---- Member row ---- */
function MemberRow({
  member,
  divider,
  hiding,
  onToggleHide,
  t,
}: {
  member: AdminMember;
  divider: boolean;
  hiding: boolean;
  onToggleHide: () => void;
  t: Translate;
}) {
  const roleLine = [
    member.role === 'admin' ? 'Admin' : t('claimed'),
    member.hidden ? t('memberHidden') : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <View
      className={
        'flex-row items-center gap-[11px] px-4 py-[11px]' +
        (divider ? ' border-t border-border' : '')
      }
      style={{ minHeight: 52 }}
    >
      <Avatar name={member.name} emoji={member.emoji} />

      <View className="min-w-0 flex-1">
        <Text
          className={
            'text-body font-medium ' +
            (member.hidden ? 'text-text-3' : 'text-text')
          }
          numberOfLines={1}
        >
          {member.name}
        </Text>
        <Text className="text-caption text-text-3">{roleLine}</Text>
      </View>

      {/* Hide/Unhide button */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={member.hidden ? t('memberUnhide') : t('memberHide')}
        onPress={onToggleHide}
        accessibilityState={{ disabled: hiding }}
        disabled={hiding}
        style={({ pressed }) => ({
          opacity: hiding ? 0.4 : pressed ? 0.7 : 1,
        })}
        className="min-h-11 items-center justify-center rounded-lg border border-border-strong px-3 py-2"
      >
        <Text className="text-label font-semibold text-text">
          {member.hidden ? t('memberUnhide') : t('memberHide')}
        </Text>
      </Pressable>
    </View>
  );
}

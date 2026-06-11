/* app/admin/result/[id].tsx — Admin: Result entry / edit / void (brief §9).
 *
 * Header: circular back button + "Enter result · HOME – AWAY".
 *
 * Entry: same Steppers as pick entry (0–15), prefilled with
 * provisional/confirmed scores when present. AdvancerPicker when KO and
 * the draft is a draw. Save CTA disabled until both scores set + advancer
 * chosen (KO draw). Void: destructive ghost button → separate Sheet.
 *
 * Save CTA → Confirm Sheet:
 *   title:  t('confirmTitle') + " — HOME h–a AWAY (· X advances)"
 *   body:   t('confirmBody') + impact chips from engine.impactOf
 *   chips:  exact (green) / outcome (amber) / draw-called (amber, KO only)
 *           / miss (void) / no-pick (void)
 *   Cancel / Confirm → supabase.rpc('admin_set_result', …) → back
 *
 * Void Sheet: destructive CTA (bg-live) → admin_set_result with p_void=true.
 *
 * Error handling:
 *   42501 → inline "admin only" message
 *   other → inline failure message
 */

import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  AdvancerPicker,
  Chip,
  IcBack,
  Sheet,
  Stepper,
} from '../../../components';
import { COLOR_LIVE, COLOR_TEXT, TABULAR } from '../../../components/constants';
import {
  impactOf,
  isKO,
  kickoffOf,
  stageLabel,
} from '../../../lib/engine';
import {
  useGame,
  useMembers,
  usePoolData,
} from '../../../lib/data';
import { useLang, useT } from '../../../lib/providers';
import { useNow } from '../../../lib/now';
import { SHADOW_CARD } from '../../../lib/theme';
import { supabase } from '../../../lib/supabase';
import type { Game, ImpactCounts, TeamCode, TeamsMap } from '../../../lib/types';
import type { Translate } from '../../../lib/i18n';

/** Local draft shape (nullable until user touches steppers). */
interface DraftResult {
  home: number | null;
  away: number | null;
  advancer: TeamCode | null;
}

export default function AdminResultEntryScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const t = useT();
  const { lang } = useLang();
  const now = useNow();

  const { id } = useLocalSearchParams<{ id: string }>();
  const game = useGame(id);
  const { pool, teams, guessesByGame } = usePoolData();
  const members = useMembers();

  if (!game) {
    return (
      <View className="flex-1 items-center justify-center bg-bg">
        <ActivityIndicator color={COLOR_TEXT} />
      </View>
    );
  }

  return (
    <EntryBody
      game={game}
      pool={pool}
      teams={teams}
      guessesByGame={guessesByGame}
      members={members}
      now={now}
      lang={lang}
      t={t}
      insetTop={insets.top}
      insetBottom={insets.bottom}
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/admin/results'))}
    />
  );
}

function EntryBody({
  game,
  pool,
  teams,
  guessesByGame,
  members,
  now,
  lang,
  t,
  insetTop,
  insetBottom,
  onBack,
}: {
  game: Game;
  pool: import('../../../lib/types').Pool | null;
  teams: TeamsMap;
  guessesByGame: Record<number, Record<string, import('../../../lib/types').Guess>>;
  members: import('../../../lib/data').PoolMember[];
  now: Date;
  lang: import('../../../lib/types').Lang;
  t: Translate;
  insetTop: number;
  insetBottom: number;
  onBack: () => void;
}) {
  const ko = kickoffOf(game);
  // Prefill with provisional or confirmed scores when present
  const prefillHome = game.score_home ?? null;
  const prefillAway = game.score_away ?? null;
  const prefillAdv = game.advancer ?? null;

  const [draft, setDraft] = useState<DraftResult>(() => ({
    home: prefillHome,
    away: prefillAway,
    advancer: prefillAdv,
  }));
  const [showConfirm, setShowConfirm] = useState(false);
  const [showVoid, setShowVoid] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ko_label = stageLabel(game.stage, t);
  const isKo = isKO(game);
  const needsAdv =
    isKo && draft.home != null && draft.away != null && draft.home === draft.away;
  const complete =
    draft.home != null &&
    draft.away != null &&
    (!needsAdv || !!draft.advancer);

  const ptsFull = pool?.pts_full ?? 3;
  const ptsPartial = pool?.pts_partial ?? 1;

  // Build AllPicks shape from guessesByGame for impactOf
  const allPicks = useMemo(() => {
    const out: Record<number, Record<string, import('../../../lib/types').Guess>> = {};
    for (const [gidStr, guesses] of Object.entries(guessesByGame)) {
      const gid = Number(gidStr);
      out[gid] = {};
      for (const [uid, g] of Object.entries(guesses)) {
        out[gid][uid] = g;
      }
    }
    return out;
  }, [guessesByGame]);

  const impact: ImpactCounts | null = useMemo(() => {
    if (!complete || draft.home == null || draft.away == null) return null;
    const draftResult = {
      home: draft.home,
      away: draft.away,
      advancer: draft.advancer,
    };
    return impactOf(
      game,
      draftResult,
      allPicks,
      members.map((m) => ({ id: m.user_id })),
      ptsFull,
      ptsPartial,
    );
  }, [complete, draft, game, allPicks, members, ptsFull, ptsPartial]);

  const updateDraft = (patch: Partial<DraftResult>) => {
    setDraft((prev) => {
      const next = { ...prev, ...patch };
      // Clear advancer when not a draw
      if (next.home != null && next.away != null && next.home !== next.away) {
        next.advancer = null;
      }
      return next;
    });
    setError(null);
  };

  const doSave = async () => {
    if (!complete || draft.home == null || draft.away == null) return;
    setSaving(true);
    setError(null);
    try {
      const { error: rpcErr } = await supabase.rpc('admin_set_result', {
        p_game_id: game.id,
        p_home: draft.home,
        p_away: draft.away,
        p_advancer: draft.advancer ?? null,
        p_void: false,
      });
      if (rpcErr) {
        const code = (rpcErr as { code?: string }).code;
        setError(code === '42501' ? 'admin only' : rpcErr.message);
        setSaving(false);
        return;
      }
      setShowConfirm(false);
      onBack();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error');
      setSaving(false);
    }
  };

  const doVoid = async () => {
    setSaving(true);
    setError(null);
    try {
      const { error: rpcErr } = await supabase.rpc('admin_set_result', {
        p_game_id: game.id,
        p_home: 0,
        p_away: 0,
        p_advancer: null,
        p_void: true,
      });
      if (rpcErr) {
        const code = (rpcErr as { code?: string }).code;
        setError(code === '42501' ? 'admin only' : rpcErr.message);
        setSaving(false);
        setShowVoid(false);
        return;
      }
      setShowVoid(false);
      onBack();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error');
      setSaving(false);
      setShowVoid(false);
    }
  };

  const headerTitle =
    t('enterResult') +
    ' · ' +
    (game.home ?? '?') +
    ' – ' +
    (game.away ?? '?');

  // Confirm sheet title with advancer note
  const confirmHeader = (() => {
    const advNote =
      draft.advancer ? ' · ' + t('advances', { team: draft.advancer }) : '';
    return (
      t('confirmTitle') +
      ' — ' +
      (game.home ?? '?') +
      ' ' +
      (draft.home ?? '?') +
      '–' +
      (draft.away ?? '?') +
      ' ' +
      (game.away ?? '?') +
      advNote
    );
  })();

  return (
    <View className="flex-1 bg-bg">
      {/* Header */}
      <View
        className="flex-row items-center gap-2 px-3"
        style={{ paddingTop: 12 + insetTop }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('back')}
          onPress={onBack}
          style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }, SHADOW_CARD]}
          className="h-11 w-11 items-center justify-center rounded-full bg-surface"
        >
          <IcBack color={COLOR_TEXT} />
        </Pressable>
        <Text className="flex-1 text-center text-label text-text-2" numberOfLines={1}>
          {headerTitle}
        </Text>
        <View className="w-11" />
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 16,
          paddingBottom: 40 + insetBottom,
          gap: 12,
        }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Stage / date line */}
        <Text className="text-center text-caption text-text-3">
          {ko_label + ' · ' + ko.toLocaleDateString(lang === 'es' ? 'es-MX' : 'en-US', {
            weekday: 'short', month: 'short', day: 'numeric',
          })}
        </Text>

        {/* Corrected note */}
        {game.corrected ? (
          <Text className="text-center text-caption font-medium text-partial">
            {t('corrected')}
          </Text>
        ) : null}

        {/* Steppers */}
        <View className="flex-row gap-3">
          <Stepper
            label={game.home ?? '?'}
            value={draft.home}
            onChange={(v) =>
              updateDraft({ home: v, away: draft.away == null ? 0 : draft.away })
            }
          />
          <Stepper
            label={game.away ?? '?'}
            value={draft.away}
            onChange={(v) =>
              updateDraft({ away: v, home: draft.home == null ? 0 : draft.home })
            }
          />
        </View>

        {/* Advancer picker (KO draw) */}
        {needsAdv && game.home && game.away ? (
          <AdvancerPicker
            home={game.home}
            away={game.away}
            selected={draft.advancer}
            onSelect={(code) => updateDraft({ advancer: code })}
            teams={teams}
            t={t}
          />
        ) : null}

        {/* Error */}
        {error ? (
          <Text
            className="text-center text-caption text-live"
            accessibilityRole="alert"
          >
            {'⚠ ' + error}
          </Text>
        ) : null}

        {/* Save CTA */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('saveResult')}
          accessibilityState={{ disabled: !complete || saving }}
          disabled={!complete || saving}
          onPress={() => setShowConfirm(true)}
          style={({ pressed }) => ({
            opacity: !complete || saving ? 0.4 : pressed ? 0.85 : 1,
          })}
          className="min-h-[52px] items-center justify-center rounded-xl bg-accent px-6 py-3"
        >
          <Text
            className="text-body font-semibold text-on-accent"
            style={TABULAR}
          >
            {saving ? '…' : t('saveResult')}
          </Text>
        </Pressable>

        {/* Void CTA — destructive outline button */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('markVoid')}
          accessibilityState={{ disabled: saving }}
          disabled={saving}
          onPress={() => setShowVoid(true)}
          style={({ pressed }) => ({
            opacity: saving ? 0.4 : pressed ? 0.7 : 1,
            borderWidth: 1.5,
            borderColor: COLOR_LIVE,
          })}
          className="min-h-[52px] items-center justify-center rounded-xl bg-surface px-6 py-3"
        >
          <Text className="text-body font-semibold text-live">{t('markVoid')}</Text>
        </Pressable>
      </ScrollView>

      {/* ── Confirm Sheet ── */}
      <Sheet
        visible={showConfirm && impact != null}
        onClose={() => setShowConfirm(false)}
      >
        <Text className="text-heading font-bold text-text" style={{ marginBottom: 6 }}>
          {confirmHeader}
        </Text>
        <Text className="text-body text-text-2" style={{ marginBottom: 10 }}>
          {t('confirmBody')}
        </Text>
        {impact ? (
          <ImpactRow impact={impact} isKo={isKo} t={t} />
        ) : null}
        <SheetButtons
          onCancel={() => setShowConfirm(false)}
          onConfirm={doSave}
          saving={saving}
          t={t}
        />
      </Sheet>

      {/* ── Void Sheet ── */}
      <Sheet visible={showVoid} onClose={() => setShowVoid(false)}>
        <Text className="text-heading font-bold text-text" style={{ marginBottom: 6 }}>
          {t('markVoid') + ' — ' + (game.home ?? '?') + ' – ' + (game.away ?? '?')}
        </Text>
        <Text className="text-body text-text-2" style={{ marginBottom: 16 }}>
          {t('voidBody')}
        </Text>
        <View className="flex-row gap-[10px]">
          <Pressable
            accessibilityRole="button"
            onPress={() => setShowVoid(false)}
            style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
            className="min-h-[52px] flex-1 items-center justify-center rounded-xl border border-border-strong bg-surface"
          >
            <Text className="text-body font-semibold text-text">{t('cancel')}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={doVoid}
            accessibilityState={{ disabled: saving }}
            disabled={saving}
            style={({ pressed }) => ({
              opacity: saving ? 0.4 : pressed ? 0.85 : 1,
            })}
            className="min-h-[52px] flex-1 items-center justify-center rounded-xl bg-live"
          >
            <Text className="text-body font-semibold text-on-accent">
              {saving ? '…' : t('confirm')}
            </Text>
          </Pressable>
        </View>
      </Sheet>
    </View>
  );
}

/* ---- Impact chips row ---- */
function ImpactRow({
  impact,
  isKo,
  t,
}: {
  impact: ImpactCounts;
  isKo: boolean;
  t: Translate;
}) {
  return (
    <View
      className="flex-row flex-wrap gap-[7px]"
      style={{ marginBottom: 16 }}
    >
      <Chip variant="exact" label={t('impExact', { n: impact.exact })} tabular />
      <Chip variant="outcome" label={t('impOutcome', { n: impact.outcome })} tabular />
      {isKo ? (
        <Chip variant="outcome" label={t('impDraw', { n: impact.draw })} tabular />
      ) : null}
      <Chip variant="void" label={t('impMiss', { n: impact.miss })} tabular />
      <Chip variant="void" label={t('impNone', { n: impact.none })} tabular />
    </View>
  );
}

/* ---- Cancel + Confirm buttons ---- */
function SheetButtons({
  onCancel,
  onConfirm,
  saving,
  t,
}: {
  onCancel: () => void;
  onConfirm: () => void;
  saving: boolean;
  t: Translate;
}) {
  return (
    <View className="flex-row gap-[10px]">
      <Pressable
        accessibilityRole="button"
        onPress={onCancel}
        style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
        className="min-h-[52px] flex-1 items-center justify-center rounded-xl border border-border-strong bg-surface"
      >
        <Text className="text-body font-semibold text-text">{t('cancel')}</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        onPress={onConfirm}
        accessibilityState={{ disabled: saving }}
        disabled={saving}
        style={({ pressed }) => ({
          opacity: saving ? 0.4 : pressed ? 0.85 : 1,
        })}
        className="min-h-[52px] flex-1 items-center justify-center rounded-xl bg-accent"
      >
        <Text className="text-body font-semibold text-on-accent">
          {saving ? '…' : t('confirm')}
        </Text>
      </Pressable>
    </View>
  );
}

/* components/AdvancerPicker.tsx — KO-draw advancer chooser (prototype .adv).
 *
 * Appears when a KO pick is a draw: "Who advances on penalties?" + a 2-button
 * grid (the two teams, flag + FIFA code). Selected button = accent fill /
 * on-accent text + a check. Until one is chosen, a red warning line shows and
 * the pick stays incomplete (caller gates the pending badge on this).
 *
 * Card chrome mirrors .adv: surface, rounded-lg, card shadow, padding 14/14/16.
 * Buttons (.adv-btn): min-height 48, rounded-md, 1.5px border-strong; selected
 * (.on): accent bg + border + on-accent text.
 */

import { Pressable, Text, View } from 'react-native';

import type { Translate } from '../lib/i18n';
import { SHADOW_CARD } from '../lib/theme';
import type { TeamCode, TeamsMap } from '../lib/types';
import { COLOR_ON_ACCENT } from './constants';
import { IcCheck } from './icons';

export function AdvancerPicker({
  home,
  away,
  selected,
  onSelect,
  teams,
  t,
}: {
  home: TeamCode;
  away: TeamCode;
  selected: TeamCode | null | undefined;
  onSelect: (code: TeamCode) => void;
  teams: TeamsMap;
  t: Translate;
}) {
  const options: TeamCode[] = [home, away];
  const required = !selected;

  return (
    <View
      className="mt-3 gap-[10px] rounded-lg bg-surface px-[14px] pb-4 pt-[14px]"
      style={SHADOW_CARD}
    >
      <Text className="text-center text-label font-semibold text-text">
        {t('whoAdvances')}
      </Text>
      {required ? (
        <Text className="text-center text-caption font-medium text-urgent" accessibilityRole="alert">
          {t('advNeeded')}
        </Text>
      ) : null}
      <View className="flex-row gap-[10px]">
        {options.map((code) => {
          const on = selected === code;
          return (
            <Pressable
              key={code}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              accessibilityLabel={t('advances', { team: code })}
              onPress={() => onSelect(code)}
              style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
              className={
                'min-h-12 flex-1 flex-row items-center justify-center gap-2 rounded-md border-[1.5px] ' +
                (on ? 'border-accent bg-accent' : 'border-border-strong bg-surface')
              }
            >
              <Text style={{ fontSize: 16 }}>{teams[code]?.flag ?? ''}</Text>
              <Text
                className={'font-semibold ' + (on ? 'text-on-accent' : 'text-text')}
                style={{ fontSize: 15 }}
              >
                {code}
              </Text>
              {on ? <IcCheck size={11} color={COLOR_ON_ACCENT} /> : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

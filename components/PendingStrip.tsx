/* components/PendingStrip.tsx — the match-card lower "you still need to pick" bar
 * (prototype .mc-strip). Lives at the bottom of an unpicked upcoming/postponed
 * card. Normal variant: surface-2 bg, text-2 left label, accent pill button.
 * Urgent variant (<2h, unpicked): urgent-soft bg, urgent (red) text, urgent
 * button — the visual escalation for the closing window.
 *
 * Left text is "Closes in {countdown}" (or "Pick who advances…" when a KO draw
 * still needs an advancer); right is the "Make your pick" pill. The whole card
 * is the tap target — the pill is visual, so it is not separately pressable
 * (pointer-events none would double-handle the press); the card's onOpen drives
 * navigation.
 */

import { Text, View } from 'react-native';

export function PendingStrip({
  leftText,
  buttonLabel,
  urgent,
}: {
  leftText: string;
  buttonLabel: string;
  urgent?: boolean;
}) {
  return (
    <View
      className={
        'flex-row items-center justify-between gap-[10px] py-[9px] pl-4 pr-[9px] ' +
        (urgent ? 'bg-urgent-soft' : 'bg-surface-2')
      }
    >
      <Text className={'flex-1 text-label font-semibold ' + (urgent ? 'text-urgent' : 'text-text-2')}>
        {leftText}
      </Text>
      <View
        className={
          'min-h-10 items-center justify-center rounded-pill px-[18px] ' +
          (urgent ? 'bg-urgent' : 'bg-accent')
        }
      >
        <Text className="text-on-accent" style={{ fontSize: 14, fontWeight: '600' }}>
          {buttonLabel}
        </Text>
      </View>
    </View>
  );
}

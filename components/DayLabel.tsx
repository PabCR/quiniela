/* components/DayLabel.tsx — the uppercase date-group label (prototype .day-label).
 *
 * label type, text-3, uppercase with caps tracking, margins matching app.css
 * (14px top / 10px bottom, 2px horizontal). The caller composes the string —
 * e.g. "TODAY · JUN 13" — from engine.fmtDay + an Intl day/month formatter.
 */

import { Text } from 'react-native';

export function DayLabel({ children }: { children: string }) {
  return (
    <Text className="mx-[2px] mb-[10px] mt-[14px] text-label uppercase tracking-[0.06em] text-text-3">
      {children}
    </Text>
  );
}

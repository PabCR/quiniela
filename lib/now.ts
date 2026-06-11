/* lib/now.ts — a ticking "now" clock for countdowns + status transitions.
 *
 * The engine is pure: every status / countdown helper takes `now: Date` as a
 * parameter (lib/engine.ts, brief §6.1). To make those re-evaluate over time —
 * a card flipping upcoming → live, a countdown ticking down — the UI needs a
 * `Date` that updates on an interval and triggers a re-render.
 *
 * useNow(intervalMs = 30000) returns a Date that advances every `intervalMs`.
 * 30s is the default: countdowns are rendered coarse (minutes / hours, never
 * seconds — see engine.fmtCountdown), so a sub-minute tick keeps the displayed
 * value fresh without burning renders. Match-detail can opt into a faster tick.
 *
 * Notes:
 *  - The timer is paused while the app is backgrounded (AppState) and a fresh
 *    Date is set immediately on re-foreground, so a long background doesn't show
 *    a stale clock for up to intervalMs after returning.
 *  - Reduced-motion is irrelevant here (no animation); this is a data clock.
 */

import { useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

export function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const start = () => {
      // Tick once immediately so a resumed/started clock is never stale.
      setNow(new Date());
      stop();
      intervalRef.current = setInterval(() => setNow(new Date()), intervalMs);
    };
    const stop = () => {
      if (intervalRef.current != null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };

    start();

    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') {
        start();
      } else {
        stop();
      }
    });

    return () => {
      stop();
      sub.remove();
    };
  }, [intervalMs]);

  return now;
}

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  CONTROL27_PANEL_IDS,
  cr27RandVote,
  initCr27Strengths,
  initCr27Votes,
} from './warrior27SyncCore';

export type WarriorMobileSyncValue = {
  votes: Record<string, number>;
  strengths: Record<string, number>;
  tick: number;
};

export const WarriorMobileSyncContext = createContext<WarriorMobileSyncValue | null>(null);

/** One simulation clock for all WARRIOR 27 surfaces (#warriors + Council embed). */
export function WarriorMobileSyncProvider({ children }: { children: ReactNode }) {
  const [votes, setVotes] = useState(initCr27Votes);
  const [strengths, setStrengths] = useState(initCr27Strengths);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const iv = window.setInterval(() => {
      setTick((t) => t + 1);
      setVotes((prev) => {
        const next = { ...prev };
        for (let i = 0; i < 4; i++) {
          const k = CONTROL27_PANEL_IDS[Math.floor(Math.random() * CONTROL27_PANEL_IDS.length)];
          if (k) next[k] = cr27RandVote();
        }
        if (Math.random() < 0.18) next.jedi = cr27RandVote();
        return next;
      });
      setStrengths((prev) => {
        const next = { ...prev };
        for (const id of CONTROL27_PANEL_IDS) {
          next[id] = Math.max(
            0.02,
            Math.min(0.98, (prev[id] ?? 0.5) + (Math.random() - 0.5) * 0.12)
          );
        }
        next.jedi = Math.max(
          0.75,
          Math.min(0.99, (prev.jedi ?? 0.9) + (Math.random() - 0.5) * 0.06)
        );
        return next;
      });
    }, 750);
    return () => window.clearInterval(iv);
  }, []);

  const value = useMemo(() => ({ votes, strengths, tick }), [votes, strengths, tick]);

  return (
    <WarriorMobileSyncContext.Provider value={value}>{children}</WarriorMobileSyncContext.Provider>
  );
}

export function useWarriorMobileSync() {
  return useContext(WarriorMobileSyncContext);
}

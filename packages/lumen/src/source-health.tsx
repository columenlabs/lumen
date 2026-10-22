// Source health (views from data domains): the sources every card on screen
// reads through its joins, one report per shell, so the assistant panel can say in one line how each
// fared (the same report that marks a column's header and the status bar).
import { type SourceState, sourceLine } from '@columenlabs/lumen-types/domains';
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
} from 'react';
import { detailOf } from './joins';

// The sources every card on screen reports, for the assistant panel's line (the same report that marks
// the columns): one map per shell, each card's entry removed when it leaves.
type Reports = Map<string, SourceState[]>;
const HealthCtx = createContext<{
  reports: Reports;
  set: (id: string, sources: SourceState[] | null) => void;
} | null>(null);

export function SourceHealthProvider({ children }: { children: ReactNode }) {
  const [reports, setReports] = useState<Reports>(() => new Map());
  // Stable, so a card's report effect runs once per change of its sources, not once per report.
  const set = useCallback(
    (id: string, sources: SourceState[] | null) =>
      setReports((was) => {
        const next = new Map(was);
        if (sources?.length) next.set(id, sources);
        else next.delete(id);
        return next;
      }),
    [],
  );
  const value = useMemo(() => ({ reports, set }), [reports, set]);
  return <HealthCtx.Provider value={value}>{children}</HealthCtx.Provider>;
}

export function useReportSources(sources: SourceState[]) {
  const ctx = useContext(HealthCtx);
  const id = useId();
  const set = ctx?.set;
  const key = JSON.stringify(sources);
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the sources' content.
  useEffect(() => {
    if (!set) return;
    set(id, sources);
    return () => set(id, null);
  }, [set, id, key]);
}

/** Every source the cards on screen read, one entry per source (the first card's word). */
export function useSourceHealth(): SourceState[] {
  const ctx = useContext(HealthCtx);
  return useMemo(() => {
    const out = new Map<string, SourceState>();
    for (const list of ctx?.reports.values() ?? [])
      for (const s of list) if (!out.has(s.id)) out.set(s.id, s);
    return [...out.values()];
  }, [ctx?.reports]);
}

/** One line on the sources behind the page: `a broker live · an app Oct 15 · Feed off`. */
export function SourcesLine({ className }: { className?: string }) {
  const sources = useSourceHealth();
  if (!sources.length) return null;
  return (
    <div className={className} title={sources.map(sourceLine).join(' · ')}>
      {sources.map((s, i) => (
        <span key={s.id} className="inline-flex items-center gap-1">
          {i > 0 && <span className="mx-1 opacity-50">·</span>}
          <span
            aria-hidden
            className={
              s.state === 'ok'
                ? 'size-1.5 rounded-full bg-gain'
                : s.state === 'failed'
                  ? 'size-1.5 rounded-full bg-destructive'
                  : 'size-1.5 rounded-full bg-muted-foreground/40'
            }
          />
          <span>{s.name}</span>
          <span className="text-muted-foreground">{detailOf(s, '')}</span>
        </span>
      ))}
    </div>
  );
}

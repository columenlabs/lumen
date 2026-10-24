// LumenCoverageCalendarMap: one year of sessions, a
// square per weekday (Mon to Fri rows), a column per week, a chip per year; a click opens that one
// day. Its own component because it reads and acts differently from LumenCoverageMap; it shares only
// the cell states, legend and tooltip (coverage-cells.tsx). Year chips change the view only: no
// refetch, and the page does not move.
import type { QueryKey, UseQueryOptions } from '@tanstack/react-query';
import { CalendarDaysIcon } from 'lucide-react';
import { type ReactNode, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CoverageCell, CoverageLegend, type CoverageLevel, CoverageTip } from './coverage-cells';
import { LumenStates, useLumenSource } from './lumen-source';
import { LumenWidget } from './lumen-widget';
import { Skeleton } from './ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group';

/** One weekday: there, expected and missing, or closed (a holiday). Days left out are not expected. */
export interface CalendarFact {
  date: string;
  state: 'present' | 'missing' | 'closed';
  /** The tooltip's second line, e.g. `3,542 contracts`. */
  note?: string;
}

export interface LumenCoverageCalendarMapProps<TRaw = unknown, TKey extends QueryKey = QueryKey> {
  source: UseQueryOptions<TRaw, Error, CalendarFact[], TKey>;
  title: string;
  /** The years offered as chips, oldest first; default every year with a fact. */
  years?: number[];
  /** The year shown, when the page loads one year at a time (its source changes with it). */
  year?: number;
  onYear?: (year: number) => void;
  /** What a present day holds, for its tooltip (`Chain stored`). */
  present?: string;
  /** A click on a present or missing day. */
  onDay?: (date: string) => void;
  /** The day opened below, outlined. */
  picked?: string | null;
  hint?: ReactNode;
  lazy?: boolean;
}

const LEVEL: Record<CalendarFact['state'], CoverageLevel> = {
  present: 'full',
  missing: 'gap',
  closed: 'none',
};
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

/** The year's weeks, Monday first; days outside the year are null. */
function weeksOf(year: number): (string | null)[][] {
  const day = new Date(Date.UTC(year, 0, 1));
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
  const weeks: (string | null)[][] = [];
  while (day.getUTCFullYear() <= year) {
    const week: (string | null)[] = [];
    for (let i = 0; i < 7; i++) {
      if (i < 5) {
        week.push(day.getUTCFullYear() === year ? day.toISOString().slice(0, 10) : null);
      }
      day.setUTCDate(day.getUTCDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
}

export function LumenCoverageCalendarMap<TRaw, TKey extends QueryKey>({
  source,
  title,
  years: yearList,
  year: shownYear,
  onYear,
  present = 'Stored',
  onDay,
  picked = null,
  hint,
  lazy = false,
}: LumenCoverageCalendarMapProps<TRaw, TKey>) {
  const { data, load, ref } = useLumenSource(source, { lazy });
  const byDate = useMemo(() => new Map((data ?? []).map((f) => [f.date, f])), [data]);
  const years = useMemo(() => {
    if (yearList) return yearList;
    return [...new Set((data ?? []).map((f) => Number(f.date.slice(0, 4))))].sort();
  }, [yearList, data]);
  const [chosen, setChosen] = useState<number | null>(null);
  const year = shownYear ?? chosen ?? (picked ? Number(picked.slice(0, 4)) : years.at(-1)) ?? 0;
  const weeks = useMemo(() => weeksOf(year), [year]);
  const scroller = useRef<HTMLDivElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run when the year changes
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [year, data]);

  const levels = new Set<CoverageLevel>();
  // One tooltip for the whole calendar, filled in for the hovered day.
  const tipFor = (date: string) => {
    const f = byDate.get(date);
    const why = !f
      ? 'Not expected'
      : f.state === 'present'
        ? present
        : f.state === 'missing'
          ? 'Expected session, nothing stored'
          : 'Market closed';
    return {
      label: date,
      detail: (
        <>
          <div>{why}</div>
          {f?.note && <div>{f.note}</div>}
        </>
      ),
    };
  };
  return (
    <div ref={ref} className="min-w-0">
      <LumenWidget
        id={title}
        kind={null}
        icon={CalendarDaysIcon}
        title={year ? `${title} · ${year}` : title}
        load={load}
        rows={data?.length}
        pad={false}
      >
        <div className="flex flex-col gap-3 px-3 pt-3 pb-3">
          <LumenStates load={load} skeleton={<Skeleton className="h-28 w-full" />}>
            {years.length > 1 && (
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                spacing={0}
                value={String(year)}
                onValueChange={(v) => {
                  if (!v) return;
                  if (onYear) onYear(Number(v));
                  else setChosen(Number(v));
                }}
                aria-label="Year"
                className="flex-wrap"
              >
                {years.map((y) => (
                  <ToggleGroupItem key={y} value={String(y)} className="num">
                    {y}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            )}
            <div ref={scroller} className="overflow-x-auto overflow-y-hidden pb-1">
              <CoverageTip content={tipFor} className="w-max">
                <div
                  className="grid w-max grid-flow-col grid-rows-5 gap-[3px]"
                  style={{ gridTemplateColumns: `2rem repeat(${weeks.length}, 13px)` }}
                >
                  {WEEKDAYS.map((l, i) => (
                    <span
                      key={l}
                      className="self-center text-[11px] leading-none text-muted-foreground"
                    >
                      {i % 2 ? '' : l}
                    </span>
                  ))}
                  {weeks.flatMap((w, wi) =>
                    w.map((date, i) => {
                      if (!date) {
                        // biome-ignore lint/suspicious/noArrayIndexKey: padding days outside the year
                        return <span key={`pad-${wi}-${i}`} className="size-[13px]" />;
                      }
                      const f = byDate.get(date);
                      const level = f ? LEVEL[f.state] : 'none';
                      levels.add(level);
                      const clickable = !!onDay && !!f && f.state !== 'closed';
                      return (
                        <CoverageCell
                          key={date}
                          level={level}
                          label={date}
                          tip={date}
                          picked={picked === date}
                          pickable={clickable}
                          disabled={!clickable}
                          onClick={clickable ? () => onDay?.(date) : undefined}
                          className="size-[13px]"
                        />
                      );
                    }),
                  )}
                </div>
              </CoverageTip>
            </div>
            <div className="border-t pt-3">
              <CoverageLegend
                levels={levels}
                hint={hint ?? (onDay ? 'Click a day to open it' : undefined)}
              />
            </div>
          </LumenStates>
        </div>
      </LumenWidget>
    </div>
  );
}

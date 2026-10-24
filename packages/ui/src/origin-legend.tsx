// The status bar's legend of where a card's columns come from (Edits in
// place): one dot and name per origin the shown columns carry, in the header rules' colours:
// the data model's groups (Holding, Symbol › a broker, ...), the assistant · <frame>, Yours · <frame>
// and Formula; then the freshness marks the columns carry.
import { FRESHNESS, FreshnessIcon, marksOf } from './freshness';
import { FORMULAS_GROUP, type ViewDomain, type ViewField, groupOf } from './view-model';

interface Origin {
  label: string;
  color: string | null;
}

/** The origins of `columns` in first-seen order, one per colour and name. */
export function originsOf<T>(domain: ViewDomain<T>, columns: ViewField<T>[]): Origin[] {
  if (!domain.groups?.length) return [];
  const out: Origin[] = [];
  const seen = new Set<string>();
  for (const f of columns) {
    const id = groupOf(domain, f);
    const g = id === FORMULAS_GROUP ? undefined : domain.groups.find((x) => x.id === id);
    const src = f.topic ? g?.sources?.[f.topic] : undefined;
    const label =
      id === FORMULAS_GROUP ? 'Formula' : src ? `${g?.label} · ${src.name}` : (g?.label ?? id);
    const color =
      id === FORMULAS_GROUP ? 'var(--color-muted-foreground)' : (src?.color ?? g?.color ?? null);
    const k = `${label}\u0000${color}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ label, color });
  }
  return out;
}

/** The legend: the origins when the columns come from two or more, and the freshness marks they
 *  carry (Live, Live calc, As of; marks). */
export function OriginLegend<T>({
  domain,
  columns,
}: {
  domain: ViewDomain<T>;
  columns: ViewField<T>[];
}) {
  const origins = originsOf(domain, columns);
  const marks = marksOf(domain, columns);
  if (origins.length < 2 && !marks.length) return null;
  return (
    <span className="hidden items-center gap-2.5 sm:inline-flex" aria-label="Column origins">
      {origins.length >= 2
        ? origins.map((o) => (
            <span key={`${o.label}${o.color}`} className="inline-flex items-center gap-1">
              <span
                aria-hidden
                className="inline-block h-0.5 w-3 rounded-full bg-current"
                style={{ color: o.color ?? 'var(--color-border)' }}
              />
              {o.label}
            </span>
          ))
        : null}
      {marks.map((m) => (
        <span key={m} className="inline-flex items-center gap-1" title={FRESHNESS[m].about}>
          <FreshnessIcon kind={m} />
          {FRESHNESS[m].label}
        </span>
      ))}
    </span>
  );
}

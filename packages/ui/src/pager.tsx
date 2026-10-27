// The compact pager, the same look as LumenView's: the count opens the page sizes,
// and the chevrons turn the page while there is more than one. Coverage views page their rows with it.
// LumenPageFooter is the fuller one under a table: first, last, numbered pages and Go to.
import { viewPageSizes } from '@columenlabs/lumen-ui-types/views';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useIsMobile } from './hooks/use-mobile';
import { IconButton } from './icon-button';
import { cn } from './lib/utils';
import { Button } from './ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { Input } from './ui/input';

export function LumenPager({
  total,
  page,
  size,
  onPage,
  onSize,
  noun = 'rows',
  sizes = viewPageSizes,
  more = false,
}: {
  /** The rows there are, or (with `more`) the rows known so far. */
  total: number;
  page: number;
  size: number;
  onPage: (page: number) => void;
  onSize: (size: number) => void;
  noun?: string;
  /** Page sizes offered; a server-paged source takes its own. */
  sizes?: readonly number[];
  /** A server-paged source has rows past `total` it has not counted: shows `of 50+` and Next. */
  more?: boolean;
}) {
  const pages = Math.max(1, Math.ceil(total / size)) + (more ? 1 : 0);
  return (
    <nav aria-label="Pages" className="flex items-center">
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="num h-7 px-2 text-xs font-normal text-muted-foreground"
            aria-label="Rows per page"
          >
            {pages > 1
              ? `${(page * size + 1).toLocaleString()}–${Math.min((page + 1) * size, total).toLocaleString()} of ${total.toLocaleString()}${more ? '+' : ''}`
              : `${total.toLocaleString()} ${noun}`}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuRadioGroup value={String(size)} onValueChange={(v) => onSize(Number(v))}>
            {sizes.map((n) => (
              <DropdownMenuRadioItem key={n} value={String(n)} className="num whitespace-nowrap">
                {n} per page
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {pages > 1 && (
        <>
          <IconButton
            icon={ChevronLeftIcon}
            label="Previous page"
            disabled={page === 0}
            onClick={() => onPage(page - 1)}
          />
          <IconButton
            icon={ChevronRightIcon}
            label="Next page"
            disabled={page >= pages - 1}
            onClick={() => onPage(page + 1)}
          />
        </>
      )}
    </nav>
  );
}

/**
 * The pages a footer numbers, from 0: the first, the last and one either side of `page`, with
 * null for each gap (`…`). A gap of one page shows that page instead. With `more` the last is not
 * known, so the list ends in a gap.
 */
export function pageList(page: number, pages: number, more = false): (number | null)[] {
  const last = more ? pages - 2 : pages - 1;
  const keep = [...new Set([0, last, page - 1, page, page + 1])]
    .filter((p) => p >= 0 && p < pages)
    .sort((a, b) => a - b);
  const out: (number | null)[] = [];
  let prev = -1;
  for (const p of keep) {
    if (p - prev === 2) out.push(prev + 1);
    else if (p - prev > 2) out.push(null);
    out.push(p);
    prev = p;
  }
  if (more) out.push(null);
  return out;
}

/**
 * The page footer under a table (`pagination.footer`): the rows shown, first and previous, the
 * numbered pages, next and last, and Go to for any page. The header's pager keeps the page size.
 * On a phone the numbers give way to Page [n] of N.
 */
export function LumenPageFooter({
  total,
  page,
  size,
  onPage,
  more = false,
  className,
}: {
  /** The rows there are, or (with `more`) the rows known so far. */
  total: number;
  /** The page shown, from 0. */
  page: number;
  size: number;
  onPage: (page: number) => void;
  /** Rows past `total` not counted yet: the count reads `of 50+` and the last page is not offered. */
  more?: boolean;
  className?: string;
}) {
  const isMobile = useIsMobile();
  const pages = Math.max(1, Math.ceil(total / size)) + (more ? 1 : 0);
  const to = (p: number) => onPage(Math.max(0, Math.min(p, pages - 1)));
  const from = Math.min(page * size + 1, total);
  const range = `${from.toLocaleString()}–${Math.min((page + 1) * size, total).toLocaleString()} of ${total.toLocaleString()}${more ? '+' : ''}`;
  const goTo = <PageInput page={page} pages={pages} onPage={to} />;
  return (
    <nav
      aria-label="Pages"
      data-page-footer
      className={cn(
        'flex items-center justify-between gap-x-3 gap-y-1 border-t px-3 py-1.5 whitespace-nowrap',
        isMobile && 'flex-col',
        className,
      )}
    >
      <span className="num truncate text-xs text-muted-foreground">{range}</span>
      <div className="flex items-center gap-0.5">
        <IconButton
          icon={ChevronsLeftIcon}
          label="First page"
          disabled={page === 0}
          onClick={() => to(0)}
        />
        <IconButton
          icon={ChevronLeftIcon}
          label="Previous page"
          disabled={page === 0}
          onClick={() => to(page - 1)}
        />
        {isMobile ? (
          <span className="num flex items-center gap-1.5 px-1 text-xs text-muted-foreground">
            Page {goTo} of {more ? `${pages - 1}+` : pages.toLocaleString()}
          </span>
        ) : (
          pageList(page, pages, more).map((p, i) =>
            p === null ? (
              <span
                // biome-ignore lint/suspicious/noArrayIndexKey: a gap has no key of its own
                key={`gap${i}`}
                aria-hidden
                className="w-5 text-center text-xs text-muted-foreground"
              >
                …
              </span>
            ) : (
              <Button
                key={p}
                variant={p === page ? 'outline' : 'ghost'}
                size="sm"
                aria-label={`Page ${p + 1}`}
                aria-current={p === page ? 'page' : undefined}
                className={cn('num min-w-7 px-1.5 text-xs', p !== page && 'text-muted-foreground')}
                onClick={() => to(p)}
              >
                {(p + 1).toLocaleString()}
              </Button>
            ),
          )
        )}
        <IconButton
          icon={ChevronRightIcon}
          label="Next page"
          disabled={page >= pages - 1}
          onClick={() => to(page + 1)}
        />
        <IconButton
          icon={ChevronsRightIcon}
          label={more ? 'Last page known' : 'Last page'}
          disabled={page >= pages - 1}
          onClick={() => to(pages - 1)}
        />
      </div>
      {!isMobile && (
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          Go to {goTo}
        </span>
      )}
    </nav>
  );
}

/** The page number a person types: Enter or leaving the box opens it, Esc puts it back. */
function PageInput({
  page,
  pages,
  onPage,
}: { page: number; pages: number; onPage: (page: number) => void }) {
  const [text, setText] = useState(String(page + 1));
  useEffect(() => setText(String(page + 1)), [page]);
  const go = () => {
    const n = Number.parseInt(text, 10);
    if (Number.isFinite(n) && n - 1 !== page) onPage(n - 1);
    else setText(String(page + 1));
  };
  return (
    <Input
      inputMode="numeric"
      aria-label={`Page, 1 to ${pages.toLocaleString()}`}
      value={text}
      onChange={(e) => setText(e.target.value.replace(/\D/g, ''))}
      onFocus={(e) => e.target.select()}
      onBlur={go}
      onKeyDown={(e) => {
        if (e.key === 'Enter') go();
        if (e.key === 'Escape' && text !== String(page + 1)) {
          e.stopPropagation();
          setText(String(page + 1));
        }
      }}
      className="num h-7 w-14 px-1.5 text-center md:text-xs"
    />
  );
}

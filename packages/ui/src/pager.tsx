// The compact pager, the same look as LumenView's: the count opens the page sizes,
// and the chevrons turn the page while there is more than one. Coverage views page their rows with it.
import { viewPageSizes } from '@columenlabs/lumen-ui-types/views';
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import { IconButton } from './icon-button';
import { Button } from './ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';

export function LumenPager({
  total,
  page,
  size,
  onPage,
  onSize,
  noun = 'rows',
  sizes = viewPageSizes,
}: {
  total: number;
  page: number;
  size: number;
  onPage: (page: number) => void;
  onSize: (size: number) => void;
  noun?: string;
  /** Page sizes offered; a server-paged source takes its own. */
  sizes?: readonly number[];
}) {
  const pages = Math.max(1, Math.ceil(total / size));
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
              ? `${page * size + 1}–${Math.min((page + 1) * size, total)} of ${total}`
              : `${total} ${noun}`}
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

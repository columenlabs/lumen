// The desktop drawer's resizable panels, loaded with the first drawer that opens, not with the page.
import type { ReactNode } from 'react';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from './ui/resizable';

type Size = `${number}%` | `${number}px`;

export function DrawerPanels({
  defaultSize,
  minSize,
  maxSize,
  children,
}: {
  defaultSize: Size;
  minSize: Size;
  maxSize: Size;
  children: ReactNode;
}) {
  return (
    <ResizablePanelGroup orientation="horizontal">
      <ResizablePanel minSize="40%" />
      <ResizableHandle withHandle className="pointer-events-auto" />
      <ResizablePanel
        defaultSize={defaultSize}
        minSize={minSize}
        maxSize={maxSize}
        data-slot="lumen-drawer"
        className="pointer-events-auto bg-popover shadow-lg"
      >
        {children}
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

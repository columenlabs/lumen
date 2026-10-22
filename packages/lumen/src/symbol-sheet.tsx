// The Symbol sheet (the assistant drafts step 1): a tap on any symbol in any view opens one sheet
// about it, the same drawer as a row's details (bottom on phone, right on desktop). The shell draws
// its header and LumenChart; the app adds its own sections
// (an app: live price, P/E, estimates, earnings, your holdings by account, its screeners). A
// app that mounts no sheet keeps opening the chart dialog straight away.
import { LineChartIcon } from 'lucide-react';
import { type ReactNode, useCallback, useState } from 'react';
import { DrawerSection } from './drawer-section';
import { LumenDrawer } from './lumen-drawer';
import { LumenChart } from './market/lumen-chart';
import { SheetContext } from './symbol-sheet-context';

/**
 * Mounts the Symbol sheet once for an app. `sections` draws the app's own sections for a symbol
 * (DrawerSections), under the shell's chart.
 */
export function SymbolSheetProvider({
  sections,
  children,
}: {
  sections?: (symbol: string) => ReactNode;
  children: ReactNode;
}) {
  const [symbol, setSymbol] = useState<string | null>(null);
  const open = useCallback((s: string) => setSymbol(s.toUpperCase()), []);
  return (
    <SheetContext.Provider value={open}>
      {children}
      <LumenDrawer open={symbol !== null} title={symbol ?? ''} onClose={() => setSymbol(null)}>
        {symbol && <SymbolSheetBody key={symbol} symbol={symbol} sections={sections} />}
      </LumenDrawer>
    </SheetContext.Provider>
  );
}

function SymbolSheetBody({
  symbol,
  sections,
}: {
  symbol: string;
  sections?: (symbol: string) => ReactNode;
}) {
  return (
    <>
      <DrawerSection icon={LineChartIcon} title="Price" defaultOpen>
        <LumenChart symbols={[symbol]} window="1Y" type="line" indicators={[]} />
      </DrawerSection>
      {sections?.(symbol)}
    </>
  );
}

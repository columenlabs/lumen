import { createContext, useContext } from 'react';

/** Opens the Symbol sheet (symbol-sheet.tsx); its own file so the views can read it. */
export const SheetContext = createContext<((symbol: string) => void) | null>(null);

/** Opens the Symbol sheet; null where the app mounted none (a symbol then opens its chart). */
export const useSymbolSheet = () => useContext(SheetContext);

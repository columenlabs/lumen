// True inside the page header's start (LumenShell `sidebar={false}`): a brand drawn there (the app
// switcher) takes its compact header form instead of the sidebar's.
import { createContext } from 'react';

export const InHeader = createContext(false);

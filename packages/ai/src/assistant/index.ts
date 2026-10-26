/**
 * An assistant for any app: a chat side panel's server. Claude on the app's tiers (named by the
 * app), the app's tools from any MCP server, the web (a plain fetch and ScrapeQL over its API),
 * hand off to a higher tier, advice, drafts the person saves, and a monthly spend cap per person.
 *
 *   const assistant = createAssistant({ name, system, tiers, groups, store, sealer, appKey });
 *   const routes = assistantRoutes(assistant, { base: '/api/assistant', caller });
 *
 * The panel and the Settings sections are `@columenlabs/lumen-ui`'s; the types they share are
 * `@columenlabs/lumen-ui-types/assistant`.
 */
export * from './engine';
export * from './models';
export * from './routes';
export {
  DEFAULT_CAP,
  type KeyDoc,
  type KeyTest,
  monthIn,
  type Paying,
  type PersonDoc,
  type SpendDoc,
  State,
  type TokenDoc,
} from './state';
export * from './store';
export * from './tools';
export * from './web';

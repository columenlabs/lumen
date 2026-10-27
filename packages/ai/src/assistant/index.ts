/**
 * An assistant for any app: a chat side panel's server. Claude or OpenAI models on the app's tiers
 * (named by the app), the app's tools from any MCP server, the web (a plain fetch and ScrapeQL over its API),
 * hand off to a higher tier, advice, drafts the person saves, and a monthly spend cap per person.
 *
 *   const assistant = createAssistant({ name, system, tiers, groups, store, sealer, appKey });
 *   const routes = assistantRoutes(assistant, { base: '/api/assistant', caller });
 *
 * The panel and the Settings sections are `@columenlabs/lumen-ui`'s; the types they share are
 * `@columenlabs/lumen-ui-types/assistant`.
 *
 * The ChatGPT plan sign-in's parts are exported on their own too, for an app that keeps the tokens and
 * calls OpenAI itself (`LumenChatgptSignin` is the panel's part for it).
 */
export * from './bearings';
export * from './chatgpt';
export * from './engine';
export * from './models';
export * from './routes';
export {
  DEFAULT_CAP,
  type KeyDoc,
  keyDocName,
  type KeyTest,
  monthIn,
  type Paying,
  type PersonDoc,
  type SpendDoc,
  State,
  type TokenDoc,
  waitText,
} from './state';
export * from './store';
export * from './tools';
export * from './web';

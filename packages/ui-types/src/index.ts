// Lumen's view model: the schemas and registries Lumen's components
// read (views, formulas, domains and joins, frames, the market widget's data), published as
// `@columenlabs/lumen-ui-types` for every app. Import a module by its path
// (`@columenlabs/lumen-ui-types/views`); this root holds what belongs to no module.

/** Request header LumenShell's Refresh sends: the server drops its cached reads once per token. */
export const REFRESH_HEADER = 'x-lumen-refresh';

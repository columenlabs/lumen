// What the kit reads from `import.meta.env`: set by Vite and most bundlers, absent elsewhere (the
// kit checks before it uses either).
interface ImportMetaEnv {
  readonly DEV?: boolean;
  readonly BASE_URL?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}

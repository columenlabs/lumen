# Contributing

Issues and pull requests are welcome.

- Use Bun (`bun install`, `bun run ...`).
- Before you open a pull request, run `bun run lint && bun run type-check && bun run build`. CI runs the same three.
- Keep the kit product-neutral. No app's names or imports go in kit code: an app passes its names through `configureLumen` and its data through `registerDomains`. `scripts/check-kit-neutral.sh` enforces this.
- Every merge to `main` publishes a new patch version. A change that breaks something sets both `packages/*/package.json` versions to the next minor (`x.y.0`).

# basic example

Smallest possible config — one app, no monorepo features, no plugins. Demonstrates the default behaviour: pick up every `**/__checks__/**/*.spec.ts` file, group by `__checks__` subfolder, render a single Markdown table of contents.

## What it shows

- The minimum config the tool needs (literally just `appName`).
- Default discovery — `__checks__/<subfolder>/*.spec.ts`.
- Default spec type (a single catch-all `Tests` section).
- `describe` / `test` / `it` / `test.step` parsing.
- Rendering of test modifiers (`test.skip` → ⏭️, `test.only` → 🎯).

## Files

- [`collect-test-cases.config.mjs`](./collect-test-cases.config.mjs) — config.
- [`__checks__/home-page.spec.ts`](./__checks__/home-page.spec.ts) — flat spec.
- [`__checks__/checkout/checkout-flow.spec.ts`](./__checks__/checkout/checkout-flow.spec.ts) — nested describe + steps.
- [`OUTPUT.md`](./OUTPUT.md) — the generated README.

## Run it

```bash
cd examples/basic
npx collect-test-cases
```

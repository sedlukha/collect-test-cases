# spec-types example

Groups tests into labelled sections by **filename pattern**. Every spec file is sorted into the first `specTypes` entry whose `pattern` matches its filename; the entry without a `pattern` becomes the catch-all.

## What it shows

- Declaring multiple `specTypes` with `order` and `pattern`.
- Using both `string` patterns (`'.auth.'`) and a `RegExp` pattern.
- A catch-all entry (no `pattern`) for unmatched files.
- How the renderer emits one `<details>` block per spec type, in `order`.

## Files

- [`collect-test-cases.config.mjs`](./collect-test-cases.config.mjs) — three spec types: `guest`, `auth`, `smoke`.
- `__checks__/checkout-page/*.spec.ts` — three filenames that match the three patterns.
- [`OUTPUT.md`](./OUTPUT.md) — the generated README, with sections in `order`.

## Run it

```bash
cd examples/spec-types
npx collect-test-cases
```

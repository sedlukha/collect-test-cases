# discovery example

Runtime discovery + `resolvePageName`. Shows the two things text parsing can't do, and how to keep a deep test tree from collapsing.

## What it shows

- **`it.each` rows, expanded.** `checkout.test.ts` declares `it.each(cards)("accepts %s", …)`. Text mode would report a single `accepts %s` entry; discovery reports one test per card (Visa / Mastercard / Amex).
- **Helper-created tests.** `cart.test.ts` calls `defineTotalsSuite()` from [`helper.ts`](./helper.ts); the `describe`/`it` calls run inside the helper, so a text parser sees nothing. Discovery finds both tests.
- **`resolvePageName`.** Both specs sit under `__tests__/pages/…`. The default rule (single segment after `specsDir`) would drop them into one `pages` group; the hook keys on the full sub-path so `pages/checkout` and `pages/cart` stay separate.

## How it runs offline

Real projects just use `vitestDiscovery()` and let it call `vitest`. To keep this example runnable without installing Vitest, the config points the adapter at a tiny stand-in, [`fake-runner.mjs`](./fake-runner.mjs), which prints the same `vitest list --json` shape:

```js
plugins: [vitestDiscovery({ command: "node", commandArgs: ["./fake-runner.mjs"] })]
```

In your own project you would delete that override:

```js
plugins: [vitestDiscovery()]
```

## Files

- [`collect-test-cases.config.mjs`](./collect-test-cases.config.mjs) — config with `vitestDiscovery` + `resolvePageName`.
- [`__tests__/pages/checkout/checkout.test.ts`](./__tests__/pages/checkout/checkout.test.ts) — `it.each` over a table.
- [`__tests__/pages/cart/cart.test.ts`](./__tests__/pages/cart/cart.test.ts) — tests created by a helper.
- [`helper.ts`](./helper.ts) — the shared helper.
- [`fake-runner.mjs`](./fake-runner.mjs) — stand-in for `vitest list --json`.
- [`OUTPUT.md`](./OUTPUT.md) — the generated result: 5 tests across two page groups.

## Run it

```bash
cd examples/discovery
npx collect-test-cases
```

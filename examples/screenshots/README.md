# screenshots example

Renders a Playwright **screenshot gallery** inline in the generated README. The renderer scans the spec for `toHaveScreenshot('name.png')` calls and emits a Markdown table with one row per OS (from `browserToOs`) and one column per locale.

## What it shows

- A `screenshot` spec type with `gallery: true`.
- The Playwright snapshot path convention: PNGs live in
  `<screenshotsDir>/<specFilename>/<base>-<projectName>---<locale>.png`.
- Default `browserToOs` mapping (`Desktop-Chrome` → `ubuntu`, `Desktop-Safari` → `macOS`).
- Default locale fallback (`['en']`) when no plugin provides `screenshotLocales`.

## Files

- [`collect-test-cases.config.mjs`](./collect-test-cases.config.mjs) — declares the `screenshot` spec type.
- [`__checks__/home-page/home-page.screenshot.spec.ts`](./__checks__/home-page/home-page.screenshot.spec.ts) — a single `toHaveScreenshot('hero.png')` call.
- [`__checks__/home-page/__screenshots__/home-page.screenshot.spec.ts/`](./__checks__/home-page/__screenshots__/home-page.screenshot.spec.ts/) — placeholder 1×1 PNGs so the table images resolve on GitHub.
- [`OUTPUT.md`](./OUTPUT.md) — the generated README.

## Want multi-locale columns?

Pair this with the `i18n` plugin (see [`../i18n`](../i18n)) — its `screenshotLocales` hook drives the column set.

## Run it

```bash
cd examples/screenshots
npx collect-test-cases
```

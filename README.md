# collect-test-cases

[![CI](https://github.com/sedlukha/collect-test-cases/actions/workflows/ci.yml/badge.svg)](https://github.com/sedlukha/collect-test-cases/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/collect-test-cases.svg)](https://www.npmjs.com/package/collect-test-cases)
[![npm downloads](https://img.shields.io/npm/dm/collect-test-cases.svg)](https://www.npmjs.com/package/collect-test-cases)
[![license](https://img.shields.io/npm/l/collect-test-cases.svg)](LICENSE)

Scan **Playwright / Vitest / Jest** spec files and generate **a single Markdown README per app** — describe blocks, test cases, steps, and an optional **screenshot gallery** all in one collapsible document. Works with **monorepos**, supports **shared spec packages**, and ships with an **i18n plugin** that resolves `t('key')` references in test titles.

## Why?

A Playwright / Vitest suite is the closest thing your product has to executable, up-to-date documentation — but `npx playwright test --list` and `vitest --list` only print plain text, and they say nothing about what each test *does*, which page it covers, or what its screenshots look like.

In a monorepo with multiple apps and shared route packages, the situation is worse: each app cares about *its* tests, plus the subset of shared specs that target it. `collect-test-cases` does the grouping for you:

- one README per app, written next to the app
- `domain → category → page → spec type` hierarchy of collapsible `<details>` blocks
- inline screenshot tables grouped by OS × locale (Playwright-style naming)
- pluggable text transforms (the bundled `i18n` plugin resolves `t('key')` calls to actual translated text)

Zero runtime dependencies. Output is plain Markdown — render it on GitHub, in your docs site, anywhere.

## Installation

```bash
npm install -D collect-test-cases
```

or with pnpm:

```bash
pnpm add -D collect-test-cases
```

Requires Node.js ≥ 22 (uses `node:fs` `globSync`).

## Quick start

1. Create `collect-test-cases.config.mjs` next to your app:

```js
/** @type {import('collect-test-cases').CollectTestCasesConfig} */
const config = {
  appName: "myapp",
  specTypes: {
    auth: { label: "🔐 Auth", order: 1, pattern: ".auth." },
    screenshot: {
      gallery: true,
      label: "📸 Visual",
      order: 0,
      pattern: ".screenshot.",
    },
    other: { label: "Tests", order: 100 },
  },
}

export default config
```

2. Run the CLI from the directory containing the config:

```bash
npx collect-test-cases
```

It writes `./README.md` next to the config:

```
Written /…/myapp/README.md (42 tests)
```

The generator walks up from `process.cwd()` until it finds the nearest `collect-test-cases.config.mjs` or `collect-test-cases.config.js`, so any subdirectory of an app works.

## CLI

```bash
collect-test-cases
```

The CLI takes no arguments. Configuration lives in `collect-test-cases.config.mjs` (or `.js`) — see [Config file](#config-file).

## Config file

The config is a plain ESM module exporting one object. All fields are optional unless noted.

| Option            | Type                              | Default                              | Description                                                                                                                |
| ----------------- | --------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `appName`         | `string`                          | basename of config dir               | Heading text (`# {appName} Test Cases`).                                                                                   |
| `outputPath`      | `string`                          | `'./README.md'`                      | Where to write the generated Markdown. Relative paths resolve against the config file's directory.                         |
| `rootDir`         | `string`                          | `'.'`                                | Project root — spec paths in the README are made relative to this directory.                                               |
| `scanDirs`        | `string[]`                        | `['./']`                             | Directories to scan for spec files.                                                                                        |
| `include`         | `string[]`                        | `['**/__checks__/**/*.spec.ts']`     | Glob patterns to include. Replace, don't merge.                                                                            |
| `exclude`         | `string[]`                        | see below                            | Glob patterns to exclude. Applied after `include`.                                                                         |
| `specsDir`        | `string`                          | `'__checks__'`                       | Folder name that marks the spec directory. Used for `pageName` grouping and screenshot path resolution — *not* discovery.  |
| `screenshotsDir`  | `string`                          | `'__screenshots__'`                  | Subfolder name where screenshot PNGs live.                                                                                 |
| `browserToOs`     | `Record<string, string>`          | `{ 'Desktop-Chrome': 'ubuntu', 'Desktop-Safari': 'macOS' }` | Playwright project name → display OS name. Drives screenshot gallery rows.                                                 |
| `specTypes`       | `Record<string, SpecTypeDefinition>` | `{ default: { label: 'Tests', order: 0 } }` | Spec-type categories. See [Spec types](#spec-types).                                                                       |
| `layout`          | `MonorepoLayout`                  | —                                    | Declarative monorepo layout — see [Monorepo layout](#monorepo-layout).                                                     |
| `resolveApp`      | `(absPath, root) => …`            | from `layout` if set, else include all | Escape-hatch override for "does this spec belong to this app?".                                                            |
| `resolveDomain`   | `(absPath, root) => string`       | from `layout` if set, else `''`      | Returns the outermost grouping label.                                                                                      |
| `resolveCategory` | `(absPath, root) => string\|null` | from `layout` if set, else subfolder | Returns the second-level grouping label.                                                                                   |
| `plugins`         | `CollectTestCasesPlugin[]`        | `[]`                                 | Renderer plugins — see [Plugin API](#plugin-api).                                                                          |

Default `exclude`: `['**/node_modules/**', '**/.git/**', '**/__screenshots__/**']`.

## Spec types

Each entry in `specTypes` declares one section in the rendered output. A spec file is assigned the first type whose `pattern` matches its filename (sorted by `order`); the entry **without** a `pattern` becomes the catch-all.

```js
specTypes: {
  gated: { label: "🔒 Gated", order: 0, pattern: /\.(auth|provider)\./ },
  screenshot: { gallery: true, label: "📸 Visual", order: 1, pattern: ".screenshot." },
  other: { label: "Tests", order: 100 },
}
```

| Field     | Type                | Description                                                                                                |
| --------- | ------------------- | ---------------------------------------------------------------------------------------------------------- |
| `label`   | `string`            | Display label (e.g. `'🔐 Auth'`).                                                                          |
| `order`   | `number`            | Lower numbers appear first.                                                                                |
| `pattern` | `RegExp \| string`  | Filename matcher. Strings match as substring; RegExps via `.test()`. Omit to make this the catch-all.      |
| `gallery` | `boolean`           | Render a screenshot table for specs of this type.                                                          |

## Monorepo layout

For monorepos with the conventional `apps/<NAME>/...` + `packages/routes/<NAME>/...` shape, set `layout` instead of writing three custom resolvers:

```js
const config = {
  appName: "myapp",
  include: ["**/__checks__/**/*.e2e.ts"],
  layout: {
    appsDir: "apps",
    categoryAnchor: "packages",
    routesDir: "packages/routes",
    sharedSpecs: {},
  },
  rootDir: "../../../..",
  scanDirs: ["../..", "../../../../packages/routes"],
}

export default config
```

| Field            | Description                                                                                                                                                                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `appsDir`        | The directory segment that contains app folders. The segment after it becomes the app name (`apps/QUIZBASE/...` → app `QUIZBASE`).                                                                                                          |
| `categoryAnchor` | Path segment that marks where the category lives (`packages` → `packages/pages/...` resolves to category `pages`). Falls back to the `__checks__` subfolder when omitted.                                                                  |
| `routesDir`      | Directory segment that contains shared route packages. The segment after it becomes the domain (`packages/routes/auth/...` → domain `auth`). Omit when shared routes aren't used.                                                          |
| `sharedSpecs`    | When set, specs outside `appsDir` are included only when the spec's nearest `playwright.config.ts` lists this `appName`. Fields: `playwrightConfigName` (default `'playwright.config.ts'`), `appNameField` (default `'appName'`), `specsDir`. |

Explicit `resolveApp` / `resolveDomain` / `resolveCategory` callbacks always override the layout-derived versions.

## Plugin API

A plugin is a plain object matching `CollectTestCasesPlugin`. Hooks:

| Hook                  | Description                                                                                                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`                | Identifier used in diagnostics. Required.                                                                                                                                 |
| `init(ctx)`           | Runs once after config is loaded. Receives `{ root }`. Plugins are init'd in the order they appear in `config.plugins`.                                                   |
| `transformText(text)` | Applied to every test title, step name, and describe name. Multiple plugins compose left-to-right.                                                                        |
| `screenshotLocales()` | Locale codes used as columns in the screenshot gallery. The first plugin returning a non-empty array wins; without one, the gallery falls back to `['en']`.               |

### Bundled plugin: i18n

`collect-test-cases/plugins/i18n` resolves `t('key')` references in test text and supplies locale order to the screenshot gallery.

```js
import { i18nPlugin } from "collect-test-cases/plugins/i18n"

const config = {
  appName: "myapp",
  plugins: [
    i18nPlugin({
      locales: ["en", "ru"],
      messages: "apps/*/messages/*.json",
    }),
  ],
}
```

| Option     | Type                  | Description                                                                                                              |
| ---------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `messages` | `string \| string[]`  | One or more glob patterns matching locale JSON files, relative to `rootDir`. The filename stem (`en.json` → `en`) is used as the locale name. |
| `locales`  | `string[]`            | Ordered list of locales to include. When omitted, all locales found in the matched files are used in alphabetical order. |

The plugin rewrites `t('key')`, `${t('key')}`, and parameterised forms like `t('key', { param: 'value' })`:

```
Before:  await expect(page.getByText(t('button.submit'))).toBeVisible()
After:   await expect(page.getByText(**en: "Submit" · ru: "Отправить"**)).toBeVisible()
```

## How grouping works

Each config produces one README. Within that README the renderer groups specs as **domain → category → pageName → TestCase[]**.

- **domain** — from `resolveDomain` (e.g. the segment after `routesDir`). Empty string skips the outer wrapper.
- **category** — from `resolveCategory`, or the `__checks__` subfolder, or `'other'` for flat specs.
- **pageName** — the subfolder inside `__checks__`, or the spec filename stem.

A spec whose `resolveApp` returns `{ sharedAcrossApps: true }` causes the renderer to inject the app name into screenshot filenames — matches Playwright's project-suffix convention.

## Screenshot gallery rendering

When a spec type has `gallery: true`, the renderer scans the spec file for `toHaveScreenshot('basename.png')` calls and emits a table:

- **rows**: OS — from `browserToOs` (defaults to `{ 'Desktop-Chrome': 'ubuntu', 'Desktop-Safari': 'macOS' }`).
- **columns**: locales — supplied by the first plugin that implements `screenshotLocales()`. Falls back to a single `en` column.

PNGs are read from `<screenshotsDir>/<specFilename>/` relative to the spec. The subdirectory name must match the spec filename exactly (Playwright `snapshotPathTemplate` convention).

Example mapping: `login-page-Desktop-Chrome---en.png` → base `login-page`, OS `ubuntu`, locale `en`.

Spec links and screenshot URLs are emitted as paths relative to the output file's directory. A spec from the same app emits `./...`; a spec from a sibling package emits `../../...`.

## Library API

The package also exports its building blocks for programmatic use:

```ts
import {
  applyConfigDefaults,
  collectSpecFiles,
  groupSpecs,
  generateAppMarkdown,
  parseSpecFile,
} from "collect-test-cases"
```

| Export                | Description                                                                                |
| --------------------- | ------------------------------------------------------------------------------------------ |
| `applyConfigDefaults` | Fills in defaults and resolves paths; returns a `ResolvedConfig`.                          |
| `collectSpecFiles`    | Runs the configured globs and returns absolute paths, deduped and sorted.                  |
| `groupSpecs`          | Turns spec paths into `GroupedSpecs` (`domain → category → pageName → TestCase[]`).        |
| `generateAppMarkdown` | Renders one app's Markdown from a `GroupedSpecs` slice.                                    |
| `parseSpecFile`       | Pulls describes, test titles, and `test.step` names out of one spec file via regex + brace tracking. |
| `run`                 | The one-shot pipeline the CLI invokes — useful for programmatic invocations from build scripts. |

## License

MIT

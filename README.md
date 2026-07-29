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
- optional [runtime discovery](#runtime-discovery) — ask the runner for its real test list so `it.each` rows and helper-created tests aren't missed

Zero runtime dependencies. Output is plain Markdown — render it on GitHub, in your docs site, anywhere.

## Example

Say you have this spec file:

```ts
// __checks__/home-page.spec.ts
import { test, expect } from "@playwright/test"

test.describe("Home page", () => {
  test("returns 200 OK", async ({ page }) => {
    const res = await page.goto("/")
    expect(res?.status()).toBe(200)
  })

  test("shows the headline", async ({ page }) => {
    await test.step("open the page", async () => {
      await page.goto("/")
    })
    await expect(page.getByRole("heading")).toBeVisible()
  })

  test.skip("redirects logged-in users", async () => {})
})
```

Run the CLI:

```bash
npx collect-test-cases
```

It writes a Markdown file that renders on GitHub as nested, collapsible sections — one click to expand each:

```
▸ Home page (3 tests)
    - ☑️ returns 200 OK             ← a step-less test is a plain line
    ▸ ☑️ shows the headline         ← only tests WITH steps get a box
          1. open the page          ← test.step() names become numbered steps
    - ⏭️ redirects logged-in users  ← test.skip keeps its marker
```

A test with `test.step()` names becomes a collapsible `<details>` block (every `▸`); a test with no steps — the norm for Vitest / Jest — renders as a plain list item instead of an empty box. Skipped / todo / only tests keep a distinct icon, so the doc never pretends a skipped test runs. When a page holds a single spec type, that level is dropped, and each file link sits with its own tests. That's the whole idea: a browsable, always-current map of what your suite covers.

## Installation

```bash
npm install -D collect-test-cases typescript
```

or with pnpm:

```bash
pnpm add -D collect-test-cases typescript
```

Requires Node.js ≥ 22 (uses `node:fs` `globSync`) and TypeScript ≥ 5 (peer-dependency — the spec parser walks the TypeScript AST so titles, modifiers, and nested `test.step()` calls are recognised reliably even when bodies contain braces in strings, comments that look like tests, dynamic titles, or JSX).

## Quick start

1. Create `collect-test-cases.config.mjs` next to your app. The smallest config is just a name:

```js
/** @type {import('collect-test-cases').CollectTestCasesConfig} */
export default {
  appName: "myapp",
}
```

   By default it scans `**/__checks__/**/*.spec.ts` (the Playwright convention). **Using Vitest or Jest?** Point `include` / `specsDir` at your tests:

```js
export default {
  appName: "myapp",
  include: ["**/*.test.ts"],
  specsDir: "src",
}
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

From here you can add spec-type sections, a screenshot gallery, an i18n plugin, or runtime discovery — see the sections below, or copy a ready-made setup from [`examples/`](./examples).

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
| `discovery`       | `{ fallback?, strict? }`          | `{ fallback: 'skip', strict: false }` | How adapter results reconcile with `include`. See [The adapter is the source of truth](#the-adapter-is-the-source-of-truth). |
| `layout`          | `MonorepoLayout`                  | —                                    | Declarative monorepo layout — see [Monorepo layout](#monorepo-layout).                                                     |
| `resolveApp`      | `(absPath, root) => …`            | from `layout` if set, else include all | Escape-hatch override for "does this spec belong to this app?".                                                            |
| `resolveDomain`   | `(absPath, root) => string`       | from `layout` if set, else `''`      | Returns the outermost grouping label.                                                                                      |
| `resolveCategory` | `(absPath, root) => string\|null` | from `layout` if set, else subfolder | Returns the second-level grouping label. An empty string skips the wrapper.                                                |
| `resolvePageName` | `(absPath, root) => string\|string[]\|null` | subfolder / filename stem            | Returns the innermost grouping label. An array puts one spec file in several page groups. Use for deep test trees the default single-segment rule collapses — see [How grouping works](#how-grouping-works). |
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
| `discover(ctx)`       | Asks a test runner which tests exist instead of parsing files as text. Receives `{ root }`, returns `DiscoveryResult[]` (or `null` to opt out; may be async). See [Runtime discovery](#runtime-discovery). |
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

## Runtime discovery

By default the tool reads spec files as **text** and finds the call forms it recognises (see [What the static parser recognises](#what-the-static-parser-recognises)). Text mode is instant and needs no runner start-up, but it cannot see tests whose titles only exist while the code runs — `it.each` rows over a computed table, or tests created inside a shared helper.

A **discovery adapter** closes that gap: it asks the runner itself which tests exist. Turn it on per config by adding one of the bundled adapters to `plugins`. Text mode stays the default — nothing changes unless you opt in.

```js
import { vitestDiscovery } from "collect-test-cases/plugins/discovery"

const config = {
  appName: "myapp",
  include: ["__tests__/**/*.test.ts"],
  specsDir: "__tests__",
  plugins: [vitestDiscovery()],
}

export default config
```

`collect-test-cases/plugins/discovery` ships three adapters, one per supported runner:

| Adapter                 | Command it runs                              | Notes                                                                 |
| ----------------------- | -------------------------------------------- | --------------------------------------------------------------------- |
| `vitestDiscovery()`     | `vitest list --json`                         | Returns `[{ name, file }]`. Use `--json`, **not** `--reporter=json`.  |
| `jestDiscovery()`       | `jest --collectTests --json` (default)       | Collection-only — never runs test bodies. Requires **Jest ≥ 30**. See [Jest modes](#jest-modes). |
| `playwrightDiscovery()` | `playwright test --list --reporter=json`     | Reads test titles from the nested-suite JSON.                         |

Each adapter accepts `{ command, commandArgs, args, cwd, configPath }`:

- **`command`** — the executable (defaults to the runner's own name, resolved on PATH). Pass an absolute path to pin a binary.
- **`commandArgs`** — arguments inserted **before** the adapter's built-in list args. Use when `command` is a launcher: `{ command: 'npx', commandArgs: ['vitest'] }` builds `npx vitest list --json`.
- **`args`** — arguments appended **after** the built-in list args (extra runner flags, e.g. `['--project', 'unit']`).
- **`configPath`** — passed through as `--config <path>`.
- **`cwd`** — working directory for the spawned process (defaults to the config's `rootDir`).

#### Jest modes

Jest is the one runner that can list tests two ways. `jestDiscovery({ mode })` selects between them:

| Mode                | Command                        | Runs test bodies? | Statuses                          |
| ------------------- | ------------------------------ | ----------------- | --------------------------------- |
| `'collect'` (default) | `jest --collectTests --json` | no                | none — every test shows the plain icon |
| `'run'`             | `jest --json`                  | yes               | real skip / todo icons            |

The default is safe and fast: `--collectTests` (Jest ≥ 30) registers every test without executing any test body or lifecycle hook, so document generation can't trigger side effects or be broken by a failing test. It cannot report real statuses, though — collection marks every test `pending`. Choose `mode: 'run'` when you want accurate skip/todo icons and accept that the whole suite runs. On Jest < 30, use `mode: 'run'`.

**Name splitting.** Runners report a nested test as one flat string joined with `' > '` (e.g. `"outer > inner > title"`). The pipeline splits on `' > '`: the last segment is the title, the earlier ones are describe blocks. This is a deliberate, documented rule — a title that itself contains `' > '` will split wrongly, but no separator is unambiguous, and this is the one the runners emit. (Exported as `NAME_SEPARATOR`.)

**Custom runners.** `discover()` is a plain plugin hook — implement it for any runner that can print its own test list:

```ts
const myRunner = {
  name: "my-runner",
  discover: ({ root }) => [
    { file: "__tests__/a.test.ts", name: "group > does a thing" },
  ],
}
```

### The adapter is the source of truth

Once a discovery adapter is active, **the runner's list is the document** — the whole point is that a text parser can't see every test, so mixing the two would put two quality levels under one total. So:

- A file the adapter reports is taken from the adapter.
- A file the adapter reports but `include` does **not** match is still included — the adapter wins.
- A file `include` matches but the adapter does **not** report is **not** silently text-parsed. By default it is left out, and the CLI prints exactly which files, with a count and how to fix it:

```
[collect-test-cases] 5 file(s) matched `include` but were not reported by the discovery adapter (skipped):
  src/pages/a/x.test.ts
  … (4 more)
  These files were skipped. Widen the adapter scope or narrow `include`.
```

This means once an adapter is active, `include` is a *filter over what the runner reports*, not an independent second source. A mismatch usually means the runner's scope and `include` are out of step — a `--dir` / `--project` / `--shard` flag on the adapter, a runner config with its own `testDir`, or a file the runner failed to load.

Tune the behaviour with the `discovery` option:

```js
export default {
  appName: "myapp",
  plugins: [vitestDiscovery()],
  discovery: {
    fallback: "skip", // 'skip' (default) drops unreported files; 'parse' text-parses them, marked in the output
    strict: false,    // true → a mismatch exits non-zero (pairs with a CI check)
  },
}
```

With `fallback: "parse"` the unreported files are still parsed, but each is flagged in the output (`⚠️ text-parsed (not reported by the runner)`) so no group silently claims to be the runner's answer. A fallback file the text parser finds **no** tests in (e.g. its tests come from a shared helper) is still named, with `⚠️ text-parsed, the parser found no tests in this file` — a group never shows a count without saying where it came from.

### What runtime mode gives up

The `--json` test list carries only `name` and `file`. So compared with text mode, runtime mode **loses**:

| Feature                        | Text mode | Runtime mode                        |
| ------------------------------ | --------- | ----------------------------------- |
| Finds every test               | no        | yes                                 |
| Helper-created tests           | no        | yes                                 |
| `it.each` rows                 | no (one entry) | yes, expanded (one entry per row) |
| skip / todo icons              | yes       | only when the adapter reports a status — Vitest's list and Jest's default collect mode do not; `jestDiscovery({ mode: 'run' })` does |
| `test.step` names              | yes       | no                                  |
| screenshot gallery             | yes       | no                                  |
| speed                          | instant   | pays the runner's start-up cost     |

Discovered files are unioned with the glob results; a file the runner covers uses the discovered tests, and any other matched file still falls back to text parsing.

## Test status icons

Each test case is rendered with a leading icon that reflects the modifier the call carried at the source. The icon makes skipped and work-in-progress tests visually distinct so the generated README doesn't pretend everything runs.

| Source             | Icon | Meaning                                     |
| ------------------ | ---- | ------------------------------------------- |
| `test('foo', …)`   | ☑️    | Plain test — will run.                      |
| `test.skip(…)`     | ⏭️    | Excluded from the run.                      |
| `test.only(…)`     | 🎯   | Focus mode — others are skipped when present. |
| `test.fixme(…)`    | 🚧   | Known broken / work in progress.            |
| `test.fail(…)`     | ⚠️    | Declared `test.fail` — expected to fail.    |
| `test.slow(…)`     | 🐌   | Extended timeout via `test.slow`.           |
| `it.todo(…)`       | 📝   | Planned, not yet implemented.               |

Modifiers are also surfaced on the `TestCase.modifier` field for any custom rendering you build on top of the library exports.

## What the static parser recognises

In text mode `parseSpecFile` walks the file's AST and recognises these declaration forms (no runner needed):

- `it()` / `test()` / `describe()`, plus the `test.describe()` / bare `describe()` block forms.
- Modifiers: `.skip`, `.only`, `.fixme`, `.fail`, `.slow`, `.todo` (`.todo` → 📝). `.concurrent` and `.sequential` read as plain tests.
- Parametrised generators: `it.each(table)('…')`, `it.for(table)('…')`, the tagged-template `` it.each`…`('…') ``, `it.skipIf(x)('…')`, `it.runIf(x)('…')`, and `describe.each(table)('…')`. A modifier may sit in between (`it.skip.each(table)('…')`).
- Fixture tests: `test.extend({})('…')` (a bare `test.extend({})` with no title call is correctly ignored).
- `test.step('…')` names, collected onto the enclosing test.

Because it never runs the file, an `it.each` row appears as a **single** entry with its template title (e.g. `each %s`), and tests created inside a helper cannot be seen at all. For those, use [Runtime discovery](#runtime-discovery).

## How grouping works

Each config produces one README. Within that README the renderer groups specs as **domain → category → pageName → TestCase[]**.

- **domain** — from `resolveDomain` (e.g. the segment after `routesDir`). Empty string skips the outer wrapper.
- **category** — from `resolveCategory`, or the `__checks__` subfolder, or `'other'` for flat specs. Empty string skips this wrapper, the same way an empty domain does. Use it when every group is a page and one box around them all adds nothing.
- **pageName** — from `resolvePageName`, or the subfolder inside `__checks__`, or the spec filename stem.

The default pageName is the **single** path segment right after `specsDir`. That collapses a deep tree — `__tests__/pages/a/x.test.ts` and `__tests__/shared/ui/z.test.ts` would both reduce to their first segment and every file would pile into one group. Set `resolvePageName` to key on the full sub-path instead:

```js
resolvePageName: (absPath, root) => {
  const parts = absPath.slice(root.length + 1).split("/")
  // everything between `__tests__/` and the file name
  return parts.slice(1, -1).join("/") || null
}
```

### One spec file in several page groups

`resolvePageName` may return an array. Then the same spec file lands in every page group it names.

Use it for a component that more than one page shows. Its tests stay in one file, so no code is copied. The document repeats them, so each page group is a full checklist:

```js
const SHARED_BY = {
  "shared/ui/status-card": ["401 Unauthorized", "403 Forbidden"],
}

resolvePageName: (absPath, root) => {
  const parts = absPath.slice(root.length + 1).split("/")
  const slice = parts.slice(1, -1).join("/")
  return SHARED_BY[slice] ?? slice ?? null
}
```

The page group counts every case it lists. Each total above the page level counts a test once, so the header number stays true. An empty array behaves like `null`.

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
  countDomains,
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
| `countDomains`        | Counts the tests in a `GroupedSpecs` slice. Skips a case repeated in a second page group.  |
| `generateAppMarkdown` | Renders one app's Markdown from a `GroupedSpecs` slice.                                    |
| `parseSpecFile`       | Pulls describes, test titles, and `test.step` names out of one spec file via regex + brace tracking. |
| `run`                 | The one-shot pipeline the CLI invokes — useful for programmatic invocations from build scripts. |

## License

MIT

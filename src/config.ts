import { existsSync } from "node:fs"
import { basename, dirname, isAbsolute, join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

import { buildLayoutResolvers, type MonorepoLayout } from "./layout-resolver.js"
import type { CollectTestCasesPlugin } from "./plugin.js"

// Result returned by `resolveApp` for a spec that should be included.
//
// - `sharedAcrossApps`: when true, the screenshot gallery injects the
//   app name into image filenames (Playwright convention for specs
//   shared across multiple `appName` projects).
export interface ResolveAppResult {
  sharedAcrossApps?: boolean
}

// Decides whether a spec belongs to the app this config represents.
// Return `null` to exclude the spec from the output entirely.
//
// `root` is the resolved monorepo root (config's `rootDir`).
//
// When omitted from config, every spec found inside `scanDirs` is
// included as-is (no `sharedAcrossApps` flag).
export type ResolveApp = (
  specAbsPath: string,
  root: string
) => ResolveAppResult | null

// Maps an absolute spec path to a category name (used as the second
// grouping level in the rendered README). Return `null` to fall back to
// the default behaviour: the subfolder of `specsDir` that holds the
// spec, or `'other'` when the spec is directly inside `specsDir`.
export type ResolveCategory = (
  specAbsPath: string,
  root: string
) => string | null

// Maps an absolute spec path to a "domain" name (the outermost grouping
// level — appears as a top-level `<details>` block in the README).
// Return an empty string (the default) to skip the domain wrapper and
// render the category directly.
export type ResolveDomain = (specAbsPath: string, root: string) => string

// Maps an absolute spec path to a page name (the innermost grouping level —
// the `<strong>` block that holds a spec's file links and its tests). Return
// `null` to fall back to the default: the subfolder of `specsDir` that holds
// the spec, or the spec's file-name stem when it sits directly in `specsDir`.
//
// Use this when a deep test tree collapses under the default rule — e.g.
// `__tests__/pages/a/x.test.ts` and `__tests__/shared/ui/z.test.ts` would both
// resolve to the single segment after `specsDir` and land in one group.
//
// Return an array to place ONE spec file in SEVERAL page groups. A component
// shared by three pages then lists its checks inside each of those pages, so a
// page group is a complete checklist. The tests stay in one file — only the
// document repeats them. The header total counts each test once. An empty
// array behaves like `null`.
export type ResolvePageName = (
  specAbsPath: string,
  root: string
) => string | string[] | null

// Controls the shape of the generated Markdown. Every field keeps the current
// output as its default, so an existing document does not change unless a
// config opts in.
export interface RenderOptions {
  // Level (1–6) at which the OUTERMOST rendered group becomes a Markdown
  // heading instead of a `<details>` box. A heading is always open, so GitHub
  // builds a table of contents for the file and browser find (Ctrl+F) reaches
  // the text inside. Levels below the outermost stay `<details>`. `0` (the
  // default) keeps the outermost group as a `<details>` box too.
  // @default 0
  headingLevel?: number

  // Wrap every `<details>` body in a `<blockquote>`. The quote only draws a bar
  // and an indent — GitHub renders Markdown inside `<details>` on its own, as
  // long as a blank line follows `</summary>`. Set to `false` to drop the
  // wrapper at every level; the nesting stays, the indent goes.
  // @default true
  quote?: boolean

  // Where a spec file's link is placed.
  // - `'line'` (default): a standalone `📄 [path]` line above the file's tests.
  // - `'heading'`: fold the link into that file's top `describe` summary (so the
  //   describe text becomes the link) and drop the standalone line. Falls back
  //   to a line for tests that have no top `describe` to carry the link.
  // - `'none'`: no link at all (a fallback "not reported by the runner" warning
  //   is still shown, since that is a warning, not a convenience link).
  // @default "line"
  specLink?: "heading" | "line" | "none"
}

export interface SpecTypeDefinition {
  // When true, a screenshot gallery is rendered for spec files of this type.
  // @default false
  gallery?: boolean

  /** Display label shown in markdown (e.g. `'🔐 Auth'`). */
  label: string

  /** Render order — lower numbers appear first. */
  order: number

  // Pattern matched against the spec filename. A `string` is treated as
  // a substring (e.g. `'.auth.'`); a `RegExp` is tested with `.test()`
  // (e.g. `/\.(auth|provider)\./`). Omit to make this type the catch-all
  // for files that match no other pattern.
  pattern?: RegExp | string
}

export interface PlaywrightDiscovery {
  command?: string
  configPath?: string
}

// Controls how discovery results reconcile with the `include` glob when a
// discovery adapter is active. The adapter is the source of truth: a file it
// did not report is never silently text-parsed into the document.
export interface DiscoveryOptions {
  // What to do with files that `include` matched but the adapter did not report.
  // - `'skip'` (default): leave them out. The adapter's list is the document.
  // - `'parse'`: text-parse them as a fallback, marked in the output as not
  //   coming from the runner.
  // Either way the CLI prints the mismatching files and how to fix it.
  fallback?: "parse" | "skip"

  // When true, any such mismatch makes the run exit non-zero — pairs with a CI
  // freshness check.
  strict?: boolean
}

export interface CollectTestCasesConfig {
  // App name shown in the generated README heading and used by the
  // grouper. When omitted, the directory containing the config file
  // is used (`basename(dirname(configPath))`).
  appName?: string

  /** Browser name → OS display name mapping used in screenshot galleries. */
  browserToOs?: Record<string, string>

  // Glob patterns excluded from discovery, applied after `include`.
  // @default ['**/node_modules/**', '**/.git/**', '**/__screenshots__/**']
  exclude?: string[]

  // Reconciliation behaviour when a discovery adapter is active. See
  // `DiscoveryOptions`. Ignored when no adapter (plugin `discover()`) runs.
  discovery?: DiscoveryOptions

  // Glob patterns used to discover spec files.
  // @default ['**/__checks__/**/*.spec.ts']
  include?: string[]

  // Declarative monorepo layout — when set, the three resolvers
  // (`resolveApp`, `resolveDomain`, `resolveCategory`) are derived
  // automatically. Any of those callbacks set explicitly overrides
  // the layout-derived version.
  layout?: MonorepoLayout

  // Path to the generated README, relative to the config file's
  // directory (or absolute).
  // @default './README.md'
  outputPath?: string

  // Discover spec files by asking Playwright (`playwright test --list`)
  // instead of globbing the repo tree. Use this when the specs a config runs
  // live outside the repo — e.g. shared specs shipped by a dependency and
  // reached through a runner's `testDir`, which a plain glob can't see.
  // Playwright resolves the config's `testDir`, so the list is exactly what
  // that config runs. When set, `scanDirs`/`include`/`exclude` and `resolveApp`
  // are ignored (the list is already scoped to this config).
  playwright?: PlaywrightDiscovery

  // Plugins extend the renderer. See `CollectTestCasesPlugin` for the hook list.
  plugins?: CollectTestCasesPlugin[]

  // Controls the shape of the generated Markdown — blockquote wrappers, whether
  // the outermost group is a heading, and where the spec link goes. Every field
  // defaults to today's output. See `RenderOptions`.
  render?: RenderOptions

  // Escape hatch: decides whether a spec found in `scanDirs` belongs
  // to this app. Prefer `layout` for standard monorepo structures.
  resolveApp?: ResolveApp

  // Maps a spec file to a category name (second grouping level).
  resolveCategory?: ResolveCategory

  // Maps a spec file to a "domain" name (outermost grouping level).
  resolveDomain?: ResolveDomain

  // Maps a spec file to a page name (innermost grouping level). Use for deep
  // test trees the default single-segment rule collapses. See `ResolvePageName`.
  resolvePageName?: ResolvePageName

  // Project root directory — used as the base for spec paths in
  // generated README links.
  // @default '.'
  rootDir?: string

  // Directories to scan for spec files.
  // @default ['./']
  scanDirs?: string[]

  // Directory name that holds screenshot snapshots.
  // @default '__screenshots__'
  screenshotsDir?: string

  // Path segment that marks the spec folder.
  // @default '__checks__'
  specsDir?: string

  // Spec type definitions keyed by type name. The entry without a
  // `pattern` becomes the catch-all. Defaults to a single catch-all
  // `{ default: { label: 'Tests', order: 0 } }`.
  specTypes?: Record<string, SpecTypeDefinition>
}

export interface ResolvedConfig {
  appName: string
  browserToOs: Record<string, string>
  discovery: Required<DiscoveryOptions>
  exclude: string[]
  include: string[]
  outputPath: string
  playwright: PlaywrightDiscovery | undefined
  plugins: CollectTestCasesPlugin[]
  render: Required<RenderOptions>
  resolveApp: ResolveApp | undefined
  resolveCategory: ResolveCategory | undefined
  resolveDomain: ResolveDomain | undefined
  resolvePageName: ResolvePageName | undefined
  rootDir: string
  scanDirs: string[]
  screenshotsDir: string
  specsDir: string
  specTypes: Record<string, SpecTypeDefinition>
}

const DEFAULT_SPEC_TYPES: Record<string, SpecTypeDefinition> = {
  default: { label: "Tests", order: 0 },
}

const DEFAULT_BROWSER_TO_OS: Record<string, string> = {
  "Desktop-Chrome": "ubuntu",
  "Desktop-Safari": "macOS",
}

const DEFAULT_INCLUDE = ["**/__checks__/**/*.spec.ts"]
const DEFAULT_EXCLUDE = [
  "**/node_modules/**",
  "**/.git/**",
  "**/__screenshots__/**",
]

const resolveFromBase = (base: string, p: string): string =>
  isAbsolute(p) ? p : resolve(base, p)

// Applies built-in defaults to user input. `configDir` is the directory
// containing the config file — used to derive `appName` and to resolve
// relative path options. When called without a `configDir`, path-derived
// fields fall back to `process.cwd()` and `appName` defaults to `'app'`.
export const applyConfigDefaults = (
  user?: Partial<CollectTestCasesConfig>,
  configDir?: string
): ResolvedConfig => {
  const base = configDir ?? process.cwd()
  const rootDir = resolveFromBase(base, user?.rootDir ?? ".")
  const outputPath = resolveFromBase(base, user?.outputPath ?? "./README.md")
  const scanDirs = (user?.scanDirs ?? ["./"]).map((p) =>
    resolveFromBase(base, p)
  )
  const appName = user?.appName ?? (configDir ? basename(configDir) : "app")
  const specsDir = user?.specsDir ?? "__checks__"

  const layoutResolvers = user?.layout
    ? buildLayoutResolvers(user.layout, appName, specsDir)
    : null

  return {
    appName,
    browserToOs: user?.browserToOs ?? { ...DEFAULT_BROWSER_TO_OS },
    discovery: {
      fallback: user?.discovery?.fallback ?? "skip",
      strict: user?.discovery?.strict ?? false,
    },
    exclude: user?.exclude ?? [...DEFAULT_EXCLUDE],
    include: user?.include ?? [...DEFAULT_INCLUDE],
    outputPath,
    playwright: user?.playwright,
    plugins: user?.plugins ?? [],
    render: {
      headingLevel: user?.render?.headingLevel ?? 0,
      quote: user?.render?.quote ?? true,
      specLink: user?.render?.specLink ?? "line",
    },
    resolveApp: user?.resolveApp ?? layoutResolvers?.resolveApp,
    resolveCategory: user?.resolveCategory ?? layoutResolvers?.resolveCategory,
    resolveDomain: user?.resolveDomain ?? layoutResolvers?.resolveDomain,
    resolvePageName: user?.resolvePageName,
    rootDir,
    scanDirs,
    screenshotsDir: user?.screenshotsDir ?? "__screenshots__",
    specTypes: user?.specTypes ?? { ...DEFAULT_SPEC_TYPES },
    specsDir,
  }
}

const CONFIG_FILENAMES = [
  "collect-test-cases.config.mjs",
  "collect-test-cases.config.js",
] as const

export const loadConfig = async (): Promise<ResolvedConfig> => {
  let dir = process.cwd()

  while (dir !== dirname(dir)) {
    for (const filename of CONFIG_FILENAMES) {
      const configPath = join(dir, filename)

      if (existsSync(configPath)) {
        const mod = (await import(pathToFileURL(configPath).href)) as Record<
          string,
          unknown
        >
        const userConfig = (mod.default ?? mod) as CollectTestCasesConfig

        return applyConfigDefaults(userConfig, dir)
      }
    }

    dir = dirname(dir)
  }

  throw new Error(
    `[collect-test-cases] No config file found. Create one of: ${CONFIG_FILENAMES.join(", ")} in your project root (or any parent directory).`
  )
}

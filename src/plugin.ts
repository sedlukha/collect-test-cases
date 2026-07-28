export interface PluginInitContext {
  /** Absolute path to the monorepo root. */
  root: string
}

export interface DiscoveryContext {
  /** Absolute path to the monorepo root (the config's `rootDir`). */
  root: string
}

// One test as reported by a runtime discovery adapter (`discover()`).
//
// - `file`: the spec file the test lives in. Absolute, or relative to the
//   discovery context `root`.
// - `name`: the test's full name. Vitest/Jest report the nested path joined
//   with `' > '` (e.g. `'outer > inner > title'`); the pipeline splits on that
//   separator into `describes` + `title`.
// - `modifier`: optional status (`'skip'`, `'todo'`, `'only'`, …) when the
//   adapter can supply it. `vitest list --json` does not, so it is usually
//   omitted.
export interface DiscoveryResult {
  file: string
  modifier?: string
  name: string
}

export interface CollectTestCasesPlugin {
  // Ask a test runner which tests exist, instead of parsing spec files as text.
  // Returns one entry per test (including `it.each` rows and helper-created
  // tests that the static parser cannot see), or `null` to opt out (e.g. the
  // runner isn't present). May be async. When any plugin returns results, those
  // tests replace the statically-parsed ones for the files they cover.
  discover?: (
    ctx: DiscoveryContext
  ) => DiscoveryResult[] | null | Promise<DiscoveryResult[] | null>
  // Called once after config is resolved and before any rendering. Use this
  // to load files relative to `root` (locale JSON, fixtures, etc.).
  // Plugins are init'd in the order they appear in `config.plugins`.
  init?: (ctx: PluginInitContext) => void | Promise<void>
  /** Identifier used in diagnostics. */
  name: string

  // Locale codes (e.g. `['en', 'ru']`) used as columns in screenshot
  // galleries. Without a plugin that provides this, galleries fall back to
  // a single 'en' column.
  //
  // When multiple plugins implement this hook, the first non-empty result wins.
  screenshotLocales?: () => string[]

  // Transform a single piece of user-authored text — test titles, step names,
  // and describe names. Multiple plugins compose left-to-right.
  //
  // Receives the text the renderer is about to emit; returns the text to
  // emit instead. Return the input unchanged if no transform applies.
  transformText?: (text: string) => string
}

export interface PluginInitContext {
  /** Absolute path to the monorepo root. */
  root: string
}

export interface CollectTestCasesPlugin {
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

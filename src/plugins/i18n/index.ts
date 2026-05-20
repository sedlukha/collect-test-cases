import type { CollectTestCasesPlugin } from "../../plugin.js"

import type { MessagesMap } from "./messages.js"
import { loadMessages, resolveTranslationKeys } from "./messages.js"

export type { MessagesMap } from "./messages.js"
export { loadMessages, resolveTranslationKeys } from "./messages.js"

export interface I18nPluginOptions {
  // Ordered list of locales to include in the output. Controls both:
  // - which `t()` translations are rendered, and
  // - column order in the screenshot gallery.
  //
  // When omitted, all locales found in the matched files are used in
  // alphabetical order.
  locales?: string[]

  // One or more glob patterns matching locale JSON files, relative to the
  // monorepo root (provided to the plugin via `init`).
  //
  // The filename stem becomes the locale name: 'en.json' → 'en'.
  // Files sharing a locale are merged — later files win on key conflicts.
  //
  // Example: 'apps/*/messages/*.json'
  messages: string | string[]
}

// Creates a plugin that:
// - replaces `t('key')`, `${t('key')}`, and parameterised forms in test text
//   with their translated values (e.g. `**en: "Submit" · ru: "Отправить"**`);
// - exposes locale order to the screenshot gallery.
export const i18nPlugin = (
  options: I18nPluginOptions
): CollectTestCasesPlugin => {
  let messages: MessagesMap = new Map()
  let locales: string[] = []

  return {
    init: ({ root }) => {
      messages = loadMessages(options.messages, root)
      locales =
        options.locales ??
        [...messages.keys()].sort((a, b) => a.localeCompare(b))
    },
    name: "i18n",
    screenshotLocales: () => locales,
    transformText: (text: string) =>
      locales.length === 0
        ? text
        : resolveTranslationKeys(text, messages, locales),
  }
}

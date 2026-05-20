import type { Dirent } from "node:fs"
import { readdirSync, readFileSync } from "node:fs"
import { basename, extname, join } from "node:path"

// A map from locale name (e.g. `'en'`, `'ru'`) to a flat object of
// dot-notation translation keys → values.
export type MessagesMap = Map<string, Record<string, string>>

const flattenObject = (
  obj: Record<string, unknown>,
  prefix = ""
): Record<string, string> => {
  const result: Record<string, string> = {}

  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key

    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      Object.assign(
        result,
        flattenObject(value as Record<string, unknown>, fullKey)
      )
    } else {
      result[fullKey] = String(value)
    }
  }

  return result
}

const segmentToRegex = (segment: string): RegExp =>
  new RegExp(
    `^${segment
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, "[^/]*")
      .replace(/\?/g, "[^/]")}$`
  )

// Minimal glob that resolves patterns with '*' per path segment.
// Supports patterns like 'apps/*/messages/en.json'.
// Does NOT support '**' (recursive wildcard).
const miniGlob = (pattern: string, root: string): string[] => {
  const segments = pattern.split("/")
  const results: string[] = []

  const walk = (currentRel: string, segIdx: number): void => {
    if (segIdx >= segments.length) {
      return
    }

    const seg = segments[segIdx] ?? ""
    const absDir = join(root, currentRel)
    const isLast = segIdx === segments.length - 1
    const re = segmentToRegex(seg)

    let entries: Dirent[]

    try {
      entries = readdirSync(absDir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      if (re.test(entry.name)) {
        const relPath = currentRel ? `${currentRel}/${entry.name}` : entry.name

        if (isLast) {
          if (entry.isFile()) {
            results.push(relPath)
          }
        } else if (entry.isDirectory()) {
          walk(relPath, segIdx + 1)
        }
      }
    }
  }

  walk("", 0)

  return results
}

// Loads and flattens locale JSON message files matched by the given glob
// pattern(s). The filename stem (e.g. `en` from `en.json`) is used as the
// locale name. Files with the same locale are merged — later files win.
export const loadMessages = (
  include: string | string[],
  root: string
): MessagesMap => {
  const patterns = Array.isArray(include) ? include : [include]
  const map: MessagesMap = new Map()

  for (const pattern of patterns) {
    const files = miniGlob(pattern, root)

    for (const file of files) {
      const locale = basename(file, extname(file))
      const absPath = join(root, file)

      try {
        const raw = JSON.parse(readFileSync(absPath, "utf-8")) as Record<
          string,
          unknown
        >
        const flat = flattenObject(raw)
        const existing = map.get(locale) ?? {}

        map.set(locale, {
          ...existing,
          ...flat,
        })
      } catch {
        console.warn(
          `[collect-test-cases-i18n] Could not load messages from ${absPath}`
        )
      }
    }
  }

  return map
}

// Resolves `t('key')` and `${t('key')}` patterns in `text` to their
// translated values.
//
// - `${t('key')}` — template-literal interpolation: the `${}` wrapper is
//    removed and the resolved value is inlined directly.
// - `t('key')` — inline annotation: replaced in place.
// - `t('key', { param: 'value' })` — parameterised call: resolved and
//    interpolated. Param values may be string literals or nested t() calls.
//
// Output format:
// - Single locale: `**"value"**`
// - Multiple locales: `**en: "value" · ru: "значение"**`
// - Key not found in any locale: original match is preserved unchanged.
export const resolveTranslationKeys = (
  text: string,
  messages: MessagesMap,
  locales: string[]
): string => {
  const lookupKey = (key: string): { locale: string; value: string }[] =>
    locales
      .map((locale) => {
        const value = messages.get(locale)?.[key]

        return value === undefined
          ? null
          : {
              locale,
              value,
            }
      })
      .filter((p): p is { locale: string; value: string } => p !== null)

  const format = (parts: { locale: string; value: string }[]): string => {
    const formatted =
      parts.length === 1
        ? `"${parts[0]?.value}"`
        : parts.map((p) => `${p.locale}: "${p.value}"`).join(" · ")

    return `**${formatted}**`
  }

  const resolveSingle = (match: string, key: string): string => {
    const parts = lookupKey(key)

    return parts.length === 0 ? match : format(parts)
  }

  const parseParams = (paramsStr: string): Record<string, string> => {
    const result: Record<string, string> = {}
    const entryRe =
      /(\w+)\s*:\s*(?:['"`]([^'"`]*)['"`]|t\(\s*['"`]([^'"`\n]+)['"`]\s*\))/g
    let m: RegExpExecArray | null

    while ((m = entryRe.exec(paramsStr)) !== null) {
      const [, paramName, stringVal, tKey] = m

      if (paramName !== undefined) {
        if (stringVal !== undefined) {
          result[paramName] = stringVal
        } else if (tKey !== undefined) {
          const parts = lookupKey(tKey)
          result[paramName] = parts[0]?.value ?? tKey
        }
      }
    }

    return result
  }

  const interpolate = (
    template: string,
    params: Record<string, string>
  ): string =>
    template.replace(
      /\{(\w+)}/g,
      (_, name: string) => params[name] ?? `{${name}}`
    )

  const resolveWithParams = (
    match: string,
    key: string,
    paramsStr: string
  ): string => {
    const parts = lookupKey(key)

    if (parts.length === 0) {
      return match
    }

    const params = parseParams(paramsStr)
    const interpolated = parts.map((p) => ({
      locale: p.locale,
      value: interpolate(p.value, params),
    }))

    return format(interpolated)
  }

  return text
    .replace(
      /\$\{\s*t\(\s*['"`]([^'"`\n]+)['"`]\s*,\s*(\{[^}]*})\s*\)\s*}/g,
      resolveWithParams
    )
    .replace(
      /\bt\(\s*['"`]([^'"`\n]+)['"`]\s*,\s*(\{[^}]*})\s*\)/g,
      resolveWithParams
    )
    .replace(/\$\{\s*t\(\s*['"`]([^'"`\n]+)['"`]\s*\)\s*}/g, resolveSingle)
    .replace(/\bt\(\s*['"`]([^'"`\n]+)['"`]\s*\)/g, resolveSingle)
}

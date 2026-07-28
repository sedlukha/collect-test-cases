import { isAbsolute, resolve } from "node:path"

import type { TestCase } from "./parser.js"
import type {
  CollectTestCasesPlugin,
  DiscoveryResult,
} from "./plugin.js"

// Separator a runner uses to join a nested test's path into one flat string.
// Vitest and Jest both report `'outer > inner > title'`. Splitting on this is a
// deliberate, documented rule: the LAST segment is the test title, the earlier
// segments are the describe blocks. It is imperfect — a title that itself
// contains `' > '` splits wrongly — but no separator is unambiguous, and this is
// the one both runners emit.
export const NAME_SEPARATOR = " > "

// Discovery adapters report a free-form modifier string; only these map onto a
// TestCase modifier (and its icon). Anything else (e.g. Vitest's `'run'`) means
// a plain test with no modifier.
const KNOWN_MODIFIERS = new Set<NonNullable<TestCase["modifier"]>>([
  "fail",
  "fixme",
  "only",
  "skip",
  "slow",
  "todo",
])

const toModifier = (raw?: string): TestCase["modifier"] =>
  raw !== undefined && KNOWN_MODIFIERS.has(raw as NonNullable<TestCase["modifier"]>)
    ? (raw as TestCase["modifier"])
    : undefined

// Splits a runner's flat test name into describe blocks + title.
const splitName = (name: string): { describes: string[]; title: string } => {
  const parts = name.split(NAME_SEPARATOR)
  const title = parts.pop() ?? name

  return { describes: parts, title }
}

// Converts flat discovery results into `casesByFile` — the map `groupSpecs`
// consumes. Keys are absolute spec paths (relative `file` values are resolved
// against `root`). The grouper fills in `pageName`/`specType`/`specPath`, so
// those carry the same placeholders `parseSpecFile` uses.
export const discoveryResultsToCases = (
  results: DiscoveryResult[],
  root: string
): Map<string, TestCase[]> => {
  const byFile = new Map<string, TestCase[]>()

  for (const result of results) {
    const abs = isAbsolute(result.file)
      ? result.file
      : resolve(root, result.file)
    const { describes, title } = splitName(result.name)
    const testCase: TestCase = {
      describes,
      pageName: "",
      specPath: abs,
      specType: "unknown",
      steps: [],
      title,
    }

    const modifier = toModifier(result.modifier)
    if (modifier) {
      testCase.modifier = modifier
    }

    const existing = byFile.get(abs)
    if (existing) {
      existing.push(testCase)
    } else {
      byFile.set(abs, [testCase])
    }
  }

  return byFile
}

// Runs every plugin `discover()` hook and merges the results. Returns `null`
// when no plugin implements the hook or none produced any tests, so callers can
// fall back to text parsing.
export const runDiscovery = async (
  plugins: CollectTestCasesPlugin[],
  root: string
): Promise<DiscoveryResult[] | null> => {
  const merged: DiscoveryResult[] = []
  let any = false

  for (const plugin of plugins) {
    if (!plugin.discover) {
      continue
    }

    const results = await plugin.discover({ root })

    if (results !== null) {
      any = true
      merged.push(...results)
    }
  }

  return any ? merged : null
}

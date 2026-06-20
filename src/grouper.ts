import { spawnSync } from "node:child_process"
import { globSync, realpathSync } from "node:fs"
import { basename, isAbsolute, relative, resolve, sep } from "node:path"

import type {
  PlaywrightDiscovery,
  ResolvedConfig,
  SpecTypeDefinition,
} from "./config.js"
import type { TestCase } from "./parser.js"
import { parseSpecFile } from "./parser.js"

// Minimal shape of `playwright test --list --reporter=json` output.
interface PlaywrightListSuite {
  file?: string
  specs?: { file?: string }[]
  suites?: PlaywrightListSuite[]
}
interface PlaywrightListJson {
  config?: { rootDir?: string }
  suites?: PlaywrightListSuite[]
}

// Ask Playwright which spec files a config runs. Unlike a glob, this resolves
// the config's `testDir`, so specs shipped by a dependency (reached through the
// runner's `testDir`, e.g. under node_modules) are included.
const collectViaPlaywright = (pw: PlaywrightDiscovery): string[] => {
  const args = ["test", "--list", "--reporter=json"]

  if (pw.configPath) {
    args.push("--config", pw.configPath)
  }

  const result = spawnSync(pw.command ?? "playwright", args, {
    encoding: "utf-8",
    maxBuffer: 64 * 1024 * 1024,
  })

  const stdout = result.stdout ?? ""
  // Notices may precede the JSON document, and some of them contain `{` that is
  // NOT valid JSON — e.g. dotenv prints JS object literals like
  // `{ quiet: true }`. So try parsing from each `{` and take the first that
  // yields a valid document (the report is the last/only valid JSON, so the few
  // invalid candidates before it fail fast).
  let json: PlaywrightListJson | undefined

  for (
    let at = stdout.indexOf("{");
    at !== -1;
    at = stdout.indexOf("{", at + 1)
  ) {
    try {
      json = JSON.parse(stdout.slice(at)) as PlaywrightListJson
      break
    } catch {
      // Not the JSON document — keep looking.
    }
  }

  if (!json) {
    throw new Error(
      `[collect-test-cases] '${pw.command ?? "playwright"} test --list' produced no parseable JSON.\n${result.stderr ?? result.error ?? ""}`
    )
  }

  const root = json.config?.rootDir ?? process.cwd()
  // Playwright lists the SAME physical spec under more than one path: the
  // runner's `testDir` symlink (e.g. <pkg>/node_modules/@scope/x/...) AND the
  // realpath inside the pnpm store (node_modules/.pnpm/<hash>/...). Both point
  // at one file, so counting both double-counts every shared spec. Key the map
  // by the canonical realpath to collapse the variants, but keep the most
  // readable path for display (prefer the symlink over the noisy .pnpm realpath).
  const byCanonical = new Map<string, string>()

  const add = (file: string): void => {
    const abs = resolve(root, file)
    let canonical: string
    try {
      canonical = realpathSync(abs)
    } catch {
      // Not a real path on disk (e.g. a test fixture) — dedup by the resolved
      // path itself.
      canonical = abs
    }

    const prev = byCanonical.get(canonical)
    byCanonical.set(canonical, prev ? prettierPath(prev, abs) : abs)
  }

  const walk = (suite: PlaywrightListSuite): void => {
    if (suite.file) {
      add(suite.file)
    }

    for (const spec of suite.specs ?? []) {
      if (spec.file) {
        add(spec.file)
      }
    }

    for (const sub of suite.suites ?? []) {
      walk(sub)
    }
  }

  for (const suite of json.suites ?? []) {
    walk(suite)
  }

  return [...byCanonical.values()].sort()
}

// Of two paths to the same file, pick the one nicer to show in the README:
// avoid the pnpm store (`node_modules/.pnpm/<hash>/...`), else the shorter.
const prettierPath = (a: string, b: string): string => {
  const aStore = a.includes(`${sep}.pnpm${sep}`)
  const bStore = b.includes(`${sep}.pnpm${sep}`)

  if (aStore !== bStore) {
    return aStore ? b : a
  }

  return a.length <= b.length ? a : b
}

// domain → category → pageName → TestCase[]
// - `domain` is '' when `resolveDomain` is not configured (or returns '')
// - `category` is the subfolder inside `specsDir`, the `resolveCategory`
//   return value, or 'other' for flat specs
export type GroupedSpecs = Map<string, Map<string, Map<string, TestCase[]>>>

const matchesPattern = (filename: string, pattern: RegExp | string): boolean =>
  typeof pattern === "string"
    ? filename.includes(pattern)
    : pattern.test(filename)

const extractSpecType = (
  filename: string,
  specTypes: Record<string, SpecTypeDefinition>
): string => {
  const sorted = Object.entries(specTypes).sort(
    ([, a], [, b]) => a.order - b.order
  )

  for (const [type, def] of sorted) {
    if (def.pattern && matchesPattern(filename, def.pattern)) {
      return type
    }
  }

  const catchAll = sorted.find(([, def]) => !def.pattern)

  return catchAll?.[0] ?? "unknown"
}

export const collectSpecFiles = (config: ResolvedConfig): string[] => {
  if (config.playwright) {
    return collectViaPlaywright(config.playwright)
  }

  const all = new Set<string>()

  for (const dir of config.scanDirs) {
    const matches = globSync(config.include, {
      cwd: dir,
      // Node 22 accepts string[] at runtime; @types/node 22.x types
      // only declare the predicate form.
      exclude: config.exclude as unknown as (entry: string) => boolean,
    })

    for (const match of matches) {
      const absolute = isAbsolute(match) ? match : resolve(dir, match)
      all.add(absolute)
    }
  }

  return [...all].sort()
}

export const groupSpecs = (
  specFiles: string[],
  config: ResolvedConfig
): GroupedSpecs => {
  const grouped: GroupedSpecs = new Map()
  const root = config.rootDir

  for (const absPath of specFiles) {
    // In Playwright-discovery mode the list is already scoped to this config,
    // so skip app filtering (the specs live outside the repo and would fail a
    // path-based resolveApp).
    const filter = config.playwright
      ? undefined
      : config.resolveApp?.(absPath, root)

    if (filter === null) {
      continue
    }

    const sharedAcrossApps = filter?.sharedAcrossApps ?? false

    const rel = relative(root, absPath)
    const parts = rel.split("/")
    const specFile = basename(absPath)
    const checksIdx = parts.indexOf(config.specsDir)
    const afterChecks = checksIdx === -1 ? undefined : parts[checksIdx + 1]
    // afterChecks is the spec file itself (flat layout) when it's the last
    // segment of the path. Otherwise it's the page subfolder.
    const checksSubfolder =
      afterChecks === undefined || afterChecks === specFile ? null : afterChecks

    const userCategory = config.resolveCategory?.(absPath, root) ?? null
    const category = userCategory ?? checksSubfolder ?? "other"
    const domain = config.resolveDomain?.(absPath, root) ?? ""
    const specType = extractSpecType(specFile, config.specTypes)
    const pageName = checksSubfolder ?? specFile.split(".")[0] ?? specFile
    const cases = parseSpecFile(absPath)
    const casesWithPath = cases.map((c) => ({
      ...c,
      pageName,
      sharedAcrossApps,
      specPath: rel,
      specType,
    }))

    let domainMap = grouped.get(domain)

    if (!domainMap) {
      domainMap = new Map()
      grouped.set(domain, domainMap)
    }

    let categoryMap = domainMap.get(category)

    if (!categoryMap) {
      categoryMap = new Map()
      domainMap.set(category, categoryMap)
    }

    if (!categoryMap.has(pageName)) {
      categoryMap.set(pageName, [])
    }

    categoryMap.get(pageName)?.push(...casesWithPath)
  }

  return grouped
}

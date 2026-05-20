import { globSync } from "node:fs"
import { basename, isAbsolute, relative, resolve } from "node:path"

import type { ResolvedConfig, SpecTypeDefinition } from "./config.js"
import type { TestCase } from "./parser.js"
import { parseSpecFile } from "./parser.js"

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
    const filter = config.resolveApp?.(absPath, root)

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

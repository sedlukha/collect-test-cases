import { existsSync, readFileSync } from "node:fs"
import { basename, dirname, join, relative } from "node:path"

import type { ResolveApp, ResolveCategory, ResolveDomain } from "./config.js"

// Describes the monorepo layout so the package can build resolvers
// for `resolveApp`/`resolveDomain`/`resolveCategory` without each
// config repeating the same parsing logic.
export interface MonorepoLayout {
  // Directory segment that contains app folders. The segment
  // immediately after it in a spec's path is treated as the app name.
  // Example: `'apps'` → `apps/QUIZBASE/...` resolves to app `QUIZBASE`.
  appsDir: string

  // Path segment used to derive the spec's category. The segment
  // immediately after it becomes the category. Example: `'packages'` →
  // `packages/pages/...` resolves to category `pages`. When omitted,
  // category falls back to the `specsDir` subfolder or `'other'`.
  categoryAnchor?: string

  // Directory segment that contains shared route packages. The segment
  // immediately after it becomes the spec's domain. Example:
  // `'packages/routes'` → `packages/routes/auth/...` resolves to
  // domain `auth`. Omit when shared routes aren't used.
  routesDir?: string

  // Shared specs filtering — describes how to read the `appName` field
  // from the `playwright.config.ts` nearest to a spec. Specs outside
  // `appsDir` are included only when the spec's playwright config lists
  // this app's name. Omit to skip shared-spec filtering entirely.
  sharedSpecs?: {
    // File name of the playwright config sitting next to `specsDir`.
    // @default 'playwright.config.ts'
    playwrightConfigName?: string

    // Field name to read in the playwright config (single string or
    // array form is supported).
    // @default 'appName'
    appNameField?: string

    // The `specsDir` value the config uses — needed to locate the
    // playwright config relative to the spec. Defaults to the
    // resolved config's `specsDir`.
    specsDir?: string
  }
}

const findPlaywrightConfigPath = (
  specAbsPath: string,
  specsDir: string,
  configName: string
): string | null => {
  let dir = dirname(specAbsPath)

  while (true) {
    if (basename(dir) === specsDir) {
      const configPath = join(dirname(dir), configName)

      return existsSync(configPath) ? configPath : null
    }

    const parent = dirname(dir)

    if (parent === dir) {
      return null
    }

    dir = parent
  }
}

const readAppNamesFromPlaywrightConfig = (
  specAbsPath: string,
  specsDir: string,
  configName: string,
  fieldName: string
): string[] | null => {
  const configPath = findPlaywrightConfigPath(specAbsPath, specsDir, configName)

  if (configPath === null) {
    return null
  }

  const content = readFileSync(configPath, "utf-8")
  const escaped = fieldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const arrayRe = new RegExp(`${escaped}\\s*:\\s*\\[([^\\]]+)\\]`)
  const arrayMatch = arrayRe.exec(content)

  if (arrayMatch) {
    const names: string[] = []
    const re = /['"`]([^'"`\n]+)['"`]/g
    let m: RegExpExecArray | null

    while ((m = re.exec(arrayMatch[1] ?? "")) !== null) {
      names.push(m[1] ?? "")
    }

    if (names.length > 0) {
      return names
    }
  }

  const singleRe = new RegExp(`${escaped}\\s*:\\s*['"\`]([^'"\`\\n]+)['"\`]`)
  const singleMatch = singleRe.exec(content)

  if (singleMatch) {
    return [singleMatch[1] ?? ""]
  }

  return null
}

const segmentAfter = (rel: string, anchor: string): string | null => {
  const parts = rel.split("/")
  const anchorParts = anchor.split("/")

  for (let i = 0; i <= parts.length - anchorParts.length; i++) {
    let match = true

    for (let j = 0; j < anchorParts.length; j++) {
      if (parts[i + j] !== anchorParts[j]) {
        match = false
        break
      }
    }

    if (match) {
      return parts[i + anchorParts.length] ?? null
    }
  }

  return null
}

// Builds the three resolvers (`resolveApp`, `resolveDomain`,
// `resolveCategory`) from a declarative `MonorepoLayout` and the
// current app's name. The resulting resolvers cover the conventional
// `apps/<NAME>/...` + `packages/routes/<NAME>/...` layout without any
// per-app boilerplate.
export const buildLayoutResolvers = (
  layout: MonorepoLayout,
  appName: string,
  defaultSpecsDir: string
): {
  resolveApp: ResolveApp
  resolveCategory: ResolveCategory | undefined
  resolveDomain: ResolveDomain | undefined
} => {
  const shared = layout.sharedSpecs
  const playwrightConfigName =
    shared?.playwrightConfigName ?? "playwright.config.ts"
  const appNameField = shared?.appNameField ?? "appName"
  const sharedSpecsDir = shared?.specsDir ?? defaultSpecsDir

  const resolveApp: ResolveApp = (specAbsPath, root) => {
    const rel = relative(root, specAbsPath)
    const appSegment = segmentAfter(rel, layout.appsDir)

    if (appSegment !== null) {
      return appSegment === appName ? {} : null
    }

    if (!shared) {
      return null
    }

    const appNames = readAppNamesFromPlaywrightConfig(
      specAbsPath,
      sharedSpecsDir,
      playwrightConfigName,
      appNameField
    )

    if (appNames === null || !appNames.includes(appName)) {
      return null
    }

    return { sharedAcrossApps: appNames.length > 1 }
  }

  const resolveDomain: ResolveDomain | undefined = layout.routesDir
    ? (specAbsPath, root) => {
        const rel = relative(root, specAbsPath)

        return segmentAfter(rel, layout.routesDir ?? "") ?? ""
      }
    : undefined

  const resolveCategory: ResolveCategory | undefined = layout.categoryAnchor
    ? (specAbsPath, root) => {
        const rel = relative(root, specAbsPath)

        return segmentAfter(rel, layout.categoryAnchor ?? "")
      }
    : undefined

  return { resolveApp, resolveCategory, resolveDomain }
}

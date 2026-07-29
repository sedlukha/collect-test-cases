import { readFileSync } from "node:fs"
import { basename, dirname, join, relative, sep } from "node:path"

import type { CollectTestCasesConfig, ResolvedConfig } from "./config.js"
import { applyConfigDefaults } from "./config.js"
import type { TestCase } from "./parser.js"
import type { CollectTestCasesPlugin } from "./plugin.js"

// Inner map type of GroupedSpecs: domain → category → pageName → TestCase[]
export type AppDomains = Map<string, Map<string, Map<string, TestCase[]>>>

// Icon prefix for a test summary line. The default ☑️ stands for a plain
// `test()`/`it()` (think "ok / will run"); modifiers map to icons that
// match how the test runner treats them:
//
//   skip   → ⏭️  (excluded from the run)
//   only   → 🎯  (the only test that will run when present)
//   fixme  → 🚧  (known broken / work in progress)
//   fail   → ⚠️  (declared `test.fail` — expected to fail)
//   slow   → 🐌  (`test.slow` — extended timeout)
//   todo   → 📝  (`it.todo` — planned, not yet implemented)
//
// Visual signal is more useful than a uniform ☑️ — it would otherwise hide
// the fact that some tests aren't actually exercised.
const iconForModifier = (modifier: TestCase["modifier"]): string => {
  switch (modifier) {
    case "fail":
      return "⚠️"
    case "fixme":
      return "🚧"
    case "only":
      return "🎯"
    case "skip":
      return "⏭️"
    case "slow":
      return "🐌"
    case "todo":
      return "📝"
    default:
      return "☑️"
  }
}

const toRelLink = (
  specPathFromRoot: string,
  root: string,
  outputDir: string
): string => {
  const abs = join(root, specPathFromRoot)
  // Markdown links must use forward slashes on every OS.
  const rel = relative(outputDir, abs).split(sep).join("/")

  return rel.startsWith(".") ? rel : `./${rel}`
}

const SCREENSHOT_NAME_RE = /\.toHaveScreenshot\(\s*(['"`])(.*?)\1/g

const parseScreenshotBasenames = (specAbsPath: string): string[] => {
  let content: string

  try {
    content = readFileSync(specAbsPath, "utf-8")
  } catch {
    return []
  }

  const basenames: string[] = []

  for (const match of content.matchAll(SCREENSHOT_NAME_RE)) {
    const name = match[2]

    if (name) {
      basenames.push(name.replace(/\.png$/i, ""))
    }
  }

  return [...new Set(basenames)]
}

const renderScreenshotGallery = (
  lines: string[],
  basenames: string[],
  screenshotsDirLink: string,
  browserToOs: Record<string, string>,
  locales: string[],
  appNameInfix: string
): void => {
  const osOrder = Object.values(browserToOs)
  const browsers = Object.keys(browserToOs)
  const infix = appNameInfix ? `-${appNameInfix}` : ""

  for (const baseName of basenames) {
    const displayName = `${baseName}${infix}`
    lines.push(`**${displayName}**`)
    lines.push("")
    lines.push(`| | ${locales.join(" | ")} |`)
    lines.push(`|---|${locales.map(() => "---").join("|")}|`)

    for (let i = 0; i < osOrder.length; i++) {
      const os = osOrder[i] ?? ""
      const browser = browsers[i] ?? ""

      const cells = locales.map((locale) => {
        const filename = `${baseName}${infix}-${browser}---${locale}.png`

        return `![${os} ${locale}](${screenshotsDirLink}/${filename})`
      })

      lines.push(`| ${os} | ${cells.join(" | ")} |`)
    }

    lines.push("")
  }
}

const renderDescribeLevel = (
  lines: string[],
  levelCases: TestCase[],
  resolve: (text: string) => string
): void => {
  const directCases = levelCases.filter((tc) => tc.describes.length === 0)
  const byDescribe = new Map<string, TestCase[]>()

  for (const tc of levelCases) {
    if (tc.describes.length > 0) {
      const key = tc.describes[0] ?? ""

      if (!byDescribe.has(key)) {
        byDescribe.set(key, [])
      }

      byDescribe.get(key)?.push({
        ...tc,
        describes: tc.describes.slice(1),
      })
    }
  }

  for (const [describeName, subCases] of byDescribe) {
    lines.push("<details>")
    lines.push(
      `<summary><strong>${resolve(describeName)}</strong> (${subCases.length} tests)</summary>`
    )
    lines.push("")
    lines.push("<blockquote>")
    lines.push("")
    renderDescribeLevel(lines, subCases, resolve)
    lines.push("</blockquote>")
    lines.push("")
    lines.push("</details>")
    lines.push("")
  }

  for (const tc of directCases) {
    // A test with no steps has nothing to reveal — render it as a plain list
    // item instead of a collapsible box holding empty space. The `<details>`
    // form is kept only when there are steps (Playwright) to show.
    if (tc.steps.length === 0) {
      lines.push(`- ${iconForModifier(tc.modifier)} ${resolve(tc.title)}`)
      continue
    }

    lines.push("<details>")
    lines.push(
      `<summary>${iconForModifier(tc.modifier)} ${resolve(tc.title)}</summary>`
    )
    lines.push("")
    lines.push("<blockquote>")
    lines.push("")

    for (let i = 0; i < tc.steps.length; i += 1) {
      lines.push(`${i + 1}. ${resolve(tc.steps[i] ?? "")}`)
    }

    lines.push("")
    lines.push("</blockquote>")
    lines.push("")
    lines.push("</details>")
    lines.push("")
  }
}

// Renders the 📸 gallery for one spec file, when it declares screenshots.
const renderGallery = (
  lines: string[],
  specPathFromRoot: string,
  sharedAcrossApps: boolean,
  root: string,
  outputDir: string,
  config: ResolvedConfig,
  appName: string,
  screenshotLocales: string[]
): void => {
  const specDir = dirname(specPathFromRoot)
  const specBasename = basename(specPathFromRoot)

  const isFlat = basename(specDir) === config.specsDir
  const screenshotsRelDir = isFlat
    ? `${dirname(specDir)}/${config.screenshotsDir}/${specBasename}`
    : `${specDir}/${config.screenshotsDir}/${specBasename}`
  const screenshotsDirLink = toRelLink(screenshotsRelDir, root, outputDir)

  const basenames = parseScreenshotBasenames(join(root, specPathFromRoot))

  if (basenames.length === 0) {
    return
  }

  // When a spec is shared across multiple apps, Playwright injects the app
  // name into the screenshot filename: baseName-APPNAME-Browser---locale.png
  const appNameInfix = sharedAcrossApps ? appName : ""

  lines.push("<details>")
  lines.push("<summary>📸 screenshots</summary>")
  lines.push("")
  lines.push("<blockquote>")
  lines.push("")
  renderScreenshotGallery(
    lines,
    basenames,
    screenshotsDirLink,
    config.browserToOs,
    screenshotLocales,
    appNameInfix
  )
  lines.push("</blockquote>")
  lines.push("")
  lines.push("</details>")
  lines.push("")
}

// Renders every case of one spec type, with each file's link attached to the
// tests that came from that file (rather than hoisted to the top of the group).
const renderTypeSection = (
  lines: string[],
  typeCases: TestCase[],
  hasGallery: boolean,
  root: string,
  outputDir: string,
  config: ResolvedConfig,
  resolveText: (text: string) => string,
  appName: string,
  screenshotLocales: string[]
): void => {
  // Strip the outer describe — it's always just the page wrapper.
  const outerDescribes = new Set(typeCases.map((tc) => tc.describes[0]))
  const stripOuter =
    outerDescribes.size === 1 &&
    outerDescribes.values().next().value !== undefined
  const cases = stripOuter
    ? typeCases.map((tc) => ({ ...tc, describes: tc.describes.slice(1) }))
    : typeCases

  // Group by spec file, keeping first-seen order, so each link sits with its
  // own tests instead of floating to the top of the group.
  const byFile = new Map<string, TestCase[]>()

  for (const tc of cases) {
    if (!byFile.has(tc.specPath)) {
      byFile.set(tc.specPath, [])
    }

    byFile.get(tc.specPath)?.push(tc)
  }

  // The gallery is derived from a single spec file — attach it to that file.
  const gallerySpec = typeCases[0]?.specPath ?? ""

  for (const [specPath, fileCases] of byFile) {
    const link = toRelLink(specPath, root, outputDir)
    // A spec is a fallback when its cases were text-parsed while a discovery
    // adapter was active — flag it so the reader knows it isn't the runner's
    // answer for that file.
    const marker = fileCases.some((tc) => tc.fallback)
      ? " — ⚠️ text-parsed (not reported by the runner)"
      : ""
    lines.push(`📄 [\`${specPath}\`](${link})${marker}`)
    lines.push("")

    if (hasGallery && specPath === gallerySpec) {
      renderGallery(
        lines,
        specPath,
        fileCases[0]?.sharedAcrossApps ?? false,
        root,
        outputDir,
        config,
        appName,
        screenshotLocales
      )
    }

    renderDescribeLevel(lines, fileCases, resolveText)
    lines.push("")
  }
}

const renderPageCases = (
  lines: string[],
  pageName: string,
  cases: TestCase[],
  root: string,
  outputDir: string,
  config: ResolvedConfig,
  resolveText: (text: string) => string,
  appName: string,
  screenshotLocales: string[]
): void => {
  // Placeholder cases for fallback files that text-parsing found no tests in
  // are not real tests — keep them out of the count and the test list, and
  // surface them as an explicit warning at the end instead.
  const realCases = cases.filter((tc) => !tc.emptyFallback)
  const emptyFallbackSpecs = [
    ...new Set(cases.filter((tc) => tc.emptyFallback).map((tc) => tc.specPath)),
  ]

  lines.push("<details>")
  lines.push(
    `<summary><strong>${pageName}</strong> (${realCases.length} tests)</summary>`
  )
  lines.push("")
  lines.push("<blockquote>")
  lines.push("")

  const specTypeOrder = Object.entries(config.specTypes)
    .sort(([, a], [, b]) => a.order - b.order)
    .map(([type]) => type)

  const typesInPlay = specTypeOrder.filter((specType) =>
    realCases.some((tc) => tc.specType === specType)
  )
  // The spec-type level carries information only when more than one type is in
  // play — with a single type its label separates nothing, so it's omitted.
  const showTypeLevel = typesInPlay.length > 1

  for (const specType of typesInPlay) {
    const typeCases = realCases.filter((tc) => tc.specType === specType)
    const def = config.specTypes[specType]

    if (showTypeLevel) {
      const label = def?.label ?? specType
      lines.push("<details>")
      lines.push(
        `<summary><strong>${label}</strong> (${typeCases.length} tests)</summary>`
      )
      lines.push("")
      lines.push("<blockquote>")
      lines.push("")
    }

    renderTypeSection(
      lines,
      typeCases,
      def?.gallery ?? false,
      root,
      outputDir,
      config,
      resolveText,
      appName,
      screenshotLocales
    )

    if (showTypeLevel) {
      lines.push("</blockquote>")
      lines.push("")
      lines.push("</details>")
      lines.push("")
    }
  }

  // Fallback files the text parser found no tests in still get named here — a
  // "0 tests" group must never stay silent about where that 0 came from.
  for (const sp of emptyFallbackSpecs) {
    const link = toRelLink(sp, root, outputDir)
    lines.push(
      `📄 [\`${sp}\`](${link}) — ⚠️ text-parsed, the parser found no tests in this file`
    )
    lines.push("")
  }

  lines.push("</blockquote>")
  lines.push("")
  lines.push("</details>")
  lines.push("")
}

interface AppMarkdownContext {
  // Optional override for the heading. Defaults to `config.appName`.
  appName?: string
  config?: CollectTestCasesConfig
  domains: AppDomains
  outputDir?: string
  root?: string
}

const composeTransforms =
  (plugins: CollectTestCasesPlugin[]): ((text: string) => string) =>
  (text) => {
    let out = text

    for (const plugin of plugins) {
      if (plugin.transformText) {
        out = plugin.transformText(out)
      }
    }

    return out
  }

const pickScreenshotLocales = (plugins: CollectTestCasesPlugin[]): string[] => {
  for (const plugin of plugins) {
    if (plugin.screenshotLocales) {
      const locales = plugin.screenshotLocales()

      if (locales.length > 0) {
        return locales
      }
    }
  }

  return ["en"]
}

export const generateAppMarkdown = ({
  appName,
  config,
  domains,
  outputDir,
  root,
}: AppMarkdownContext): string => {
  const resolvedConfig = applyConfigDefaults(config)
  const resolveText = composeTransforms(resolvedConfig.plugins)
  const screenshotLocales = pickScreenshotLocales(resolvedConfig.plugins)
  const effectiveAppName = appName ?? resolvedConfig.appName
  const effectiveRoot = root ?? resolvedConfig.rootDir
  const effectiveOutputDir = outputDir ?? effectiveRoot

  const total = countDomains(domains)

  const lines: string[] = [
    `# ${effectiveAppName} Test Cases`,
    "",
    "_Auto-generated. Do not edit manually._",
    "",
    `**${total} tests**`,
    "",
  ]

  // Empty-fallback placeholders don't count as tests, but a document made up
  // ONLY of them must still render (to warn about the files).
  const hasEmptyFallback = flattenDomains(domains).some((tc) => tc.emptyFallback)

  if (total === 0 && !hasEmptyFallback) {
    return lines.join("\n")
  }

  for (const [domain, packageTypes] of domains) {
    const domainCases = [...packageTypes.values()]
      .flatMap((pages) => [...pages.values()])
      .flat()
    const domainTotal = domainCases.filter(isCountedCase).length

    if (
      !domainCases.some(isRealCase) &&
      !domainCases.some((tc) => tc.emptyFallback)
    ) {
      continue
    }

    if (domain !== "") {
      lines.push("<details>")
      lines.push(
        `<summary><strong>${domain}</strong> (${domainTotal} tests)</summary>`
      )
      lines.push("")
      lines.push("<blockquote>")
      lines.push("")
    }

    for (const [packageType, pages] of packageTypes) {
      const pkgCases = [...pages.values()].flat()
      const pkgTotal = pkgCases.filter(isCountedCase).length

      if (
        !pkgCases.some(isRealCase) &&
        !pkgCases.some((tc) => tc.emptyFallback)
      ) {
        continue
      }

      lines.push("<details>")
      lines.push(
        `<summary><strong>${packageType}</strong> (${pkgTotal} tests)</summary>`
      )
      lines.push("")
      lines.push("<blockquote>")
      lines.push("")

      for (const [pageName, cases] of pages) {
        renderPageCases(
          lines,
          pageName,
          cases,
          effectiveRoot,
          effectiveOutputDir,
          resolvedConfig,
          resolveText,
          effectiveAppName,
          screenshotLocales
        )
      }

      lines.push("</blockquote>")
      lines.push("")
      lines.push("</details>")
      lines.push("")
    }

    if (domain !== "") {
      lines.push("</blockquote>")
      lines.push("")
      lines.push("</details>")
      lines.push("")
    }
  }

  return lines.join("\n")
}

const isRealCase = (tc: TestCase): boolean => !tc.emptyFallback

// A page group lists every case it shows, so a repeated case is part of that
// list. A total above the page level counts each test once instead. So a spec
// file placed in several page groups does not inflate the number.
const isCountedCase = (tc: TestCase): boolean => isRealCase(tc) && !tc.pageRepeat

const flattenDomains = (domains: AppDomains): TestCase[] =>
  [...domains.values()]
    .flatMap((pkgs) => [...pkgs.values()])
    .flatMap((pages) => [...pages.values()])
    .flat()

// Counts real tests only — empty-fallback placeholders are not tests.
const countDomains = (domains: AppDomains): number =>
  flattenDomains(domains).filter(isCountedCase).length

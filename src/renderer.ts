import { readFileSync } from "node:fs"
import { basename, dirname, join, relative } from "node:path"

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
  const rel = relative(outputDir, abs)

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
    lines.push("<details>")
    lines.push(
      `<summary>${iconForModifier(tc.modifier)} ${resolve(tc.title)}</summary>`
    )
    lines.push("")

    if (tc.steps.length > 0) {
      lines.push("<blockquote>")
      lines.push("")

      for (let i = 0; i < tc.steps.length; i += 1) {
        lines.push(`${i + 1}. ${resolve(tc.steps[i] ?? "")}`)
      }

      lines.push("")
      lines.push("</blockquote>")
    }

    lines.push("")
    lines.push("</details>")
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
  lines.push("<details>")
  lines.push(
    `<summary><strong>${pageName}</strong> (${cases.length} tests)</summary>`
  )
  lines.push("")
  lines.push("<blockquote>")
  lines.push("")

  const specTypeOrder = Object.entries(config.specTypes)
    .sort(([, a], [, b]) => a.order - b.order)
    .map(([type]) => type)

  for (const specType of specTypeOrder) {
    const typeCases = cases.filter((tc) => tc.specType === specType)

    if (typeCases.length > 0) {
      const def = config.specTypes[specType]
      const label = def?.label ?? specType
      lines.push("<details>")
      lines.push(
        `<summary><strong>${label}</strong> (${typeCases.length} tests)</summary>`
      )
      lines.push("")
      lines.push("<blockquote>")
      lines.push("")

      const specPaths = [...new Set(typeCases.map((tc) => tc.specPath))]

      for (const sp of specPaths) {
        const link = toRelLink(sp, root, outputDir)
        lines.push(`📄 [\`${sp}\`](${link})`)
        lines.push("")
      }

      if (def?.gallery) {
        const firstSpecPath = typeCases[0]?.specPath ?? ""
        const specDir = dirname(firstSpecPath)
        const specBasename = basename(firstSpecPath)

        const isFlat = basename(specDir) === config.specsDir
        const screenshotsRelDir = isFlat
          ? `${dirname(specDir)}/${config.screenshotsDir}/${specBasename}`
          : `${specDir}/${config.screenshotsDir}/${specBasename}`
        const screenshotsDirLink = toRelLink(screenshotsRelDir, root, outputDir)

        const specAbsPath = join(root, firstSpecPath)
        const basenames = parseScreenshotBasenames(specAbsPath)

        // When a spec is shared across multiple apps, Playwright injects the
        // app name into the screenshot filename:
        //   baseName-APPNAME-Browser---locale.png
        const appNameInfix = typeCases[0]?.sharedAcrossApps ? appName : ""

        if (basenames.length > 0) {
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
        }
      }

      // Strip the outer describe — it's always just the page wrapper
      const outerDescribes = new Set(typeCases.map((tc) => tc.describes[0]))
      const casesToRender =
        outerDescribes.size === 1 &&
        outerDescribes.values().next().value !== undefined
          ? typeCases.map((tc) => ({
              ...tc,
              describes: tc.describes.slice(1),
            }))
          : typeCases

      renderDescribeLevel(lines, casesToRender, resolveText)
      lines.push("")
      lines.push("</blockquote>")
      lines.push("")
      lines.push("</details>")
      lines.push("")
    }
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

  if (total === 0) {
    return lines.join("\n")
  }

  for (const [domain, packageTypes] of domains) {
    const domainTotal = [...packageTypes.values()]
      .flatMap((pages) => [...pages.values()])
      .flat().length

    if (domainTotal === 0) {
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
      const pkgTotal = [...pages.values()].flat().length

      if (pkgTotal === 0) {
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

const countDomains = (domains: AppDomains): number =>
  [...domains.values()]
    .flatMap((pkgs) => [...pkgs.values()])
    .flatMap((pages) => [...pages.values()])
    .flat().length

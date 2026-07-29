import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, relative } from "node:path"

import { loadConfig } from "./config.js"
import {
  discoveryResultsToCases,
  reconcileDiscovery,
  runDiscovery,
} from "./discovery.js"
import { collectSpecFiles, groupSpecs } from "./grouper.js"
import { countDomains, generateAppMarkdown } from "./renderer.js"

export type {
  CollectTestCasesConfig,
  ResolveApp,
  ResolveAppResult,
  ResolveCategory,
  ResolveDomain,
  ResolvedConfig,
  ResolvePageName,
  SpecTypeDefinition,
} from "./config.js"
export { applyConfigDefaults, loadConfig } from "./config.js"
export type { GroupedSpecs } from "./grouper.js"
export { collectSpecFiles, groupSpecs } from "./grouper.js"
export type { MonorepoLayout } from "./layout-resolver.js"
export { buildLayoutResolvers } from "./layout-resolver.js"
export type { TestCase } from "./parser.js"
export { parseSpecFile } from "./parser.js"
export type {
  CollectTestCasesPlugin,
  DiscoveryContext,
  DiscoveryResult,
  PluginInitContext,
} from "./plugin.js"
export type { DiscoveryReconciliation } from "./discovery.js"
export {
  discoveryResultsToCases,
  NAME_SEPARATOR,
  reconcileDiscovery,
  runDiscovery,
} from "./discovery.js"
export type { AppDomains } from "./renderer.js"
export { countDomains, generateAppMarkdown } from "./renderer.js"

// Emits the stdout diagnostic (and, in strict mode, throws) for files that
// `include` matched but a discovery adapter did not report. A silent mismatch
// is exactly the failure this tool exists to remove — so it is always printed.
const reportDiscoveryMismatch = (
  rec: {
    fellBack: string[]
    skipped: string[]
  },
  root: string,
  strict: boolean
): void => {
  const files = rec.skipped.length > 0 ? rec.skipped : rec.fellBack

  if (files.length === 0) {
    return
  }

  const fellBack = rec.fellBack.length > 0
  const shown = files.slice(0, 10).map((f) => `  ${relative(root, f)}`)
  const more = files.length - shown.length
  const tail = fellBack
    ? "  These files were text-parsed as a fallback and marked in the output. Widen the adapter scope or narrow `include`."
    : "  These files were skipped. Widen the adapter scope or narrow `include`."

  const message = [
    `[collect-test-cases] ${files.length} file(s) matched \`include\` but were not reported by the discovery adapter${fellBack ? "" : " (skipped)"}:`,
    ...shown,
    ...(more > 0 ? [`  … (${more} more)`] : []),
    tail,
  ].join("\n")

  if (strict) {
    throw new Error(message)
  }

  console.warn(message)
}

// Runs the full collect-test-cases pipeline: loads the nearest config
// file, discovers spec files, runs plugin `init` hooks, groups specs,
// renders the README, and writes it to disk.
export const run = async (): Promise<void> => {
  const config = await loadConfig()

  for (const plugin of config.plugins) {
    await plugin.init?.({ root: config.rootDir })
  }

  // Runtime discovery (opt-in via a plugin `discover()` hook) asks the runner
  // which tests exist. Its cases replace text parsing for the files it covers.
  const discovered = await runDiscovery(config.plugins, config.rootDir)
  const casesByFile = discovered
    ? discoveryResultsToCases(discovered, config.rootDir)
    : undefined

  const globbed = collectSpecFiles(config)

  // When an adapter is active it is the source of truth: its files are the
  // document. Files `include` matched but the adapter did not report are either
  // skipped (default) or text-parsed as a marked fallback — never silently
  // merged. See `reconcileDiscovery`.
  let specFiles = globbed

  if (casesByFile) {
    const rec = reconcileDiscovery(
      globbed,
      casesByFile,
      config.discovery.fallback
    )
    specFiles = rec.specFiles
    reportDiscoveryMismatch(rec, config.rootDir, config.discovery.strict)
  }

  if (specFiles.length === 0) {
    console.warn(
      `[collect-test-cases] No spec files found under ${config.scanDirs.join(", ")}`
    )
  }

  const domains = groupSpecs(specFiles, config, casesByFile)
  // The renderer owns this count, so the log line always matches the number the
  // document prints in its header.
  const total = countDomains(domains)

  const markdown = generateAppMarkdown({
    config,
    domains,
    outputDir: dirname(config.outputPath),
    root: config.rootDir,
  })

  mkdirSync(dirname(config.outputPath), { recursive: true })
  writeFileSync(config.outputPath, markdown, "utf-8")
  console.info(`Written ${config.outputPath} (${total} tests)`)
}

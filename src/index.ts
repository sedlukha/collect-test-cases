import { mkdirSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"

import { loadConfig } from "./config.js"
import {
  discoveryResultsToCases,
  runDiscovery,
} from "./discovery.js"
import { collectSpecFiles, groupSpecs } from "./grouper.js"
import { generateAppMarkdown } from "./renderer.js"

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
export {
  discoveryResultsToCases,
  NAME_SEPARATOR,
  runDiscovery,
} from "./discovery.js"
export type { AppDomains } from "./renderer.js"
export { generateAppMarkdown } from "./renderer.js"

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

  // Discovered files are unioned with globbed ones: a discovery adapter may
  // report tests in files a glob can't reach (or vice versa). Files present in
  // both use the discovered cases (see `groupSpecs`).
  const globbed = collectSpecFiles(config)
  const specFiles = casesByFile
    ? [...new Set([...globbed, ...casesByFile.keys()])].sort()
    : globbed

  if (specFiles.length === 0) {
    console.warn(
      `[collect-test-cases] No spec files found under ${config.scanDirs.join(", ")}`
    )
  }

  const domains = groupSpecs(specFiles, config, casesByFile)
  const total = [...domains.values()]
    .flatMap((c) => [...c.values()])
    .flatMap((p) => [...p.values()])
    .flat().length

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

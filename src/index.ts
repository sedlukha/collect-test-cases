import { mkdirSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"

import { loadConfig } from "./config.js"
import { collectSpecFiles, groupSpecs } from "./grouper.js"
import { generateAppMarkdown } from "./renderer.js"

export type {
  CollectTestCasesConfig,
  ResolveApp,
  ResolveAppResult,
  ResolveCategory,
  ResolveDomain,
  ResolvedConfig,
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
  PluginInitContext,
} from "./plugin.js"
export type { AppDomains } from "./renderer.js"
export { generateAppMarkdown } from "./renderer.js"

// Runs the full collect-test-cases pipeline: loads the nearest config
// file, discovers spec files, runs plugin `init` hooks, groups specs,
// renders the README, and writes it to disk.
export const run = async (): Promise<void> => {
  const config = await loadConfig()
  const specFiles = collectSpecFiles(config)

  if (specFiles.length === 0) {
    console.warn(
      `[collect-test-cases] No spec files found under ${config.scanDirs.join(", ")}`
    )
  }

  for (const plugin of config.plugins) {
    await plugin.init?.({ root: config.rootDir })
  }

  const domains = groupSpecs(specFiles, config)
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

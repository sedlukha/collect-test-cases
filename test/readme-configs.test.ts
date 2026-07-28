import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { test } from "node:test"

// Extracts every fenced config block from README.md and imports it, so a broken
// example (a syntax error, a wrong import path, a renamed export) fails CI on
// the day it is written. This validates the config's *shape* and its imports;
// the runtime argv behaviour of the adapters is covered separately by
// test/real-runners.test.ts against real Vitest and Jest.

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, "..")
const readme = readFileSync(join(repoRoot, "README.md"), "utf-8")

// Map the public package specifiers to the local source, so the blocks import
// without a built dist/ (tsx imports the .ts directly).
const SPECIFIER_MAP: [RegExp, string][] = [
  [
    /(["'])collect-test-cases\/plugins\/discovery\1/g,
    pathToFileURL(join(repoRoot, "src/plugins/discovery/index.ts")).href,
  ],
  [
    /(["'])collect-test-cases\/plugins\/i18n\1/g,
    pathToFileURL(join(repoRoot, "src/plugins/i18n/index.ts")).href,
  ],
  [
    /(["'])collect-test-cases\1/g,
    pathToFileURL(join(repoRoot, "src/index.ts")).href,
  ],
]

const rewriteSpecifiers = (code: string): string =>
  SPECIFIER_MAP.reduce(
    (acc, [re, replacement]) => acc.replace(re, `"${replacement}"`),
    code
  )

const discoveryUrl = pathToFileURL(
  join(repoRoot, "src/plugins/discovery/index.ts")
).href
const i18nUrl = pathToFileURL(join(repoRoot, "src/plugins/i18n/index.ts")).href

// Some README blocks reference a helper (`vitestDiscovery`, `i18nPlugin`, …)
// shown as imported in an earlier block. Prepend the import when the block uses
// the name but doesn't import it itself, so each block stands alone.
const injectMissingImports = (code: string): string => {
  const preamble: string[] = []
  const discoveryHelpers = [
    "vitestDiscovery",
    "jestDiscovery",
    "playwrightDiscovery",
  ].filter((n) => new RegExp(`\\b${n}\\b`).test(code))

  if (discoveryHelpers.length > 0 && !code.includes("plugins/discovery")) {
    preamble.push(
      `import { ${discoveryHelpers.join(", ")} } from "${discoveryUrl}"`
    )
  }

  if (/\bi18nPlugin\b/.test(code) && !code.includes("plugins/i18n")) {
    preamble.push(`import { i18nPlugin } from "${i18nUrl}"`)
  }

  return preamble.length > 0 ? `${preamble.join("\n")}\n${code}` : code
}

// Pull every ```js / ```ts fenced block that is a full config (exports default).
const extractConfigBlocks = (md: string): string[] => {
  const blocks: string[] = []
  const fence = /```(?:js|ts|javascript|typescript)\n([\s\S]*?)```/g
  let m: RegExpExecArray | null

  while ((m = fence.exec(md)) !== null) {
    const body = m[1] ?? ""
    if (body.includes("export default")) {
      blocks.push(body)
    }
  }

  return blocks
}

const blocks = extractConfigBlocks(readme)

test("README contains config blocks to check", () => {
  assert.ok(blocks.length >= 4, `found only ${blocks.length} config blocks`)
})

for (const [i, block] of blocks.entries()) {
  test(`README config block #${i + 1} imports and yields a config object`, async () => {
    const dir = mkdtempSync(join(tmpdir(), "ctc-readme-"))
    const file = join(dir, `config-${i}.mjs`)

    try {
      writeFileSync(file, injectMissingImports(rewriteSpecifiers(block)), "utf-8")
      const mod = (await import(pathToFileURL(file).href)) as {
        default?: unknown
      }
      assert.equal(
        typeof mod.default,
        "object",
        "block should `export default` a config object"
      )
      assert.notEqual(mod.default, null)
    } finally {
      rmSync(dir, { force: true, recursive: true })
    }
  })
}

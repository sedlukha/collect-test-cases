import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { test } from "node:test"

// Runs every fenced config block from README.md through the CLI — not just an
// import. A config that parses but builds a command that cannot run (the #3
// `npx` bug) must fail here. Blocks that genuinely cannot run in the test
// sandbox are skipped through the explicit, named SKIP list below, so a skip is
// always visible rather than accidental.

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, "..")
const readme = readFileSync(join(repoRoot, "README.md"), "utf-8")

const tsxBin = join(repoRoot, "node_modules/.bin/tsx")
const cliSrc = join(repoRoot, "src/cli/index.ts")
const repoBin = join(repoRoot, "node_modules/.bin")
const repoNodeModules = join(repoRoot, "node_modules")

// Map the public package specifiers to local source, so a block imports without
// a built dist/ (the CLI runs under tsx, which loads the .ts directly).
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

const discoveryUrl = pathToFileURL(
  join(repoRoot, "src/plugins/discovery/index.ts")
).href
const i18nUrl = pathToFileURL(join(repoRoot, "src/plugins/i18n/index.ts")).href

const rewriteSpecifiers = (code: string): string =>
  SPECIFIER_MAP.reduce(
    (acc, [re, replacement]) => acc.replace(re, `"${replacement}"`),
    code
  )

// Some blocks reference a helper (`vitestDiscovery`, `i18nPlugin`, …) shown as
// imported in an earlier block. Prepend the import when the block uses the name
// but doesn't import it, so each block stands alone.
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

// Blocks that can't run in the sandbox, each with a visible reason.
const SKIP: { match: RegExp; reason: string }[] = [
  {
    match: /\bappsDir\b|\blayout\b/,
    reason: "monorepo layout: rootDir/scanDirs point outside the temp project",
  },
  {
    match: /\bplaywrightDiscovery\b/,
    reason: "playwright is not installed in the test sandbox",
  },
]

// Turn the first `include` glob into a concrete sample path a spec can live at.
// Literal segments (e.g. `__tests__`) are kept; `**` is dropped (it matches
// zero dirs); a `*` segment becomes `x`.
const globToSamplePath = (pattern: string): string =>
  pattern
    .split("/")
    .filter((seg) => seg !== "**")
    .map((seg) => (seg.includes("*") ? seg.replace(/[*?]/g, "x") : seg))
    .join("/")

const SPEC_CONTENT = `import { it } from "vitest"\nit("sample case", () => {})\n`

interface RunResult {
  outputExists: (rel: string) => boolean
  status: number | null
  stderr: string
}

// Writes `configSource` as the config in a fresh temp project, drops in the
// given files, runs the CLI there, and removes the project afterwards.
const runProject = (
  configSource: string,
  files: { content: string; path: string }[]
): RunResult => {
  const dir = mkdtempSync(join(tmpdir(), "ctc-readme-"))

  try {
    // Let `import "vitest"` (and any runner binary) resolve from the repo.
    symlinkSync(repoNodeModules, join(dir, "node_modules"), "dir")
    writeFileSync(
      join(dir, "collect-test-cases.config.mjs"),
      injectMissingImports(rewriteSpecifiers(configSource)),
      "utf-8"
    )

    for (const f of files) {
      const abs = join(dir, f.path)
      mkdirSync(dirname(abs), { recursive: true })
      writeFileSync(abs, f.content, "utf-8")
      // A shebang file is spawned directly by an adapter — make it executable.
      if (f.content.startsWith("#!")) {
        chmodSync(abs, 0o755)
      }
    }

    const proc = spawnSync(tsxBin, [cliSrc], {
      cwd: dir,
      encoding: "utf-8",
      env: { ...process.env, PATH: `${repoBin}:${process.env.PATH ?? ""}` },
      maxBuffer: 64 * 1024 * 1024,
    })

    // Capture output existence before the dir is removed.
    const outputs = new Map<string, boolean>()
    const check = (rel: string): boolean => {
      if (!outputs.has(rel)) {
        outputs.set(rel, existsSync(resolve(dir, rel)))
      }

      return outputs.get(rel) ?? false
    }
    // Pre-read the two paths callers ask about.
    check("./README.md")

    return {
      outputExists: check,
      status: proc.status,
      stderr: proc.stderr ?? "",
    }
  } finally {
    rmSync(dir, { force: true, recursive: true })
  }
}

const blocks = extractConfigBlocks(readme)

test("README contains config blocks to check", () => {
  assert.ok(blocks.length >= 4, `found only ${blocks.length} config blocks`)
})

for (const [i, block] of blocks.entries()) {
  const skip = SKIP.find((s) => s.match.test(block))

  test(
    `README config block #${i + 1} runs through the CLI`,
    skip ? { skip: skip.reason } : {},
    async () => {
      // Read the config (with rewritten specifiers) to learn its include glob.
      const metaDir = mkdtempSync(join(tmpdir(), "ctc-readme-meta-"))
      const metaFile = join(metaDir, "meta.mjs")
      writeFileSync(metaFile, injectMissingImports(rewriteSpecifiers(block)))
      const config = (
        (await import(pathToFileURL(metaFile).href)) as {
          default: {
            include?: string[]
            outputPath?: string
          }
        }
      ).default
      rmSync(metaDir, { force: true, recursive: true })

      const includes = config.include ?? ["**/__checks__/**/*.spec.ts"]
      const specPath = globToSamplePath(includes[0] ?? "**/*.spec.ts")
      const outputPath = config.outputPath ?? "./README.md"

      const r = runProject(block, [{ content: SPEC_CONTENT, path: specPath }])
      assert.equal(
        r.status,
        0,
        `CLI exited ${r.status}\n${r.stderr}`
      )
      assert.ok(r.outputExists(outputPath), `expected ${outputPath} written`)
    }
  )
}

// Regression guard for the #3 bug: an adapter option set that builds a command
// with the runner name in the WRONG position must FAIL when run. Proves the
// harness above can catch that class of bug (an import-only test cannot).
const POSITION_SENSITIVE_LAUNCHER = `#!/usr/bin/env node
// Only emits valid JSON when invoked as: <launcher> vitest list --json
// The old bug built: <launcher> list --json vitest  (runner name last).
const argv = process.argv.slice(2)
if (argv[0] !== "vitest") {
  process.stderr.write("could not determine executable to run\\n")
  process.exit(1)
}
process.stdout.write("[]\\n")
`

const launcherConfig = (adapterOpts: string): string => `
import { vitestDiscovery } from "${discoveryUrl}"
export default {
  appName: "probe",
  include: ["__tests__/**/*.test.ts"],
  specsDir: "__tests__",
  specTypes: { other: { label: "Tests", order: 100 } },
  plugins: [vitestDiscovery(${adapterOpts})],
}
`

const launcherFiles = [
  { content: POSITION_SENSITIVE_LAUNCHER, path: "run.mjs" },
  { content: SPEC_CONTENT, path: "__tests__/x.test.ts" },
]

test("regression: the fixed commandArgs form runs", () => {
  const r = runProject(
    launcherConfig(`{ command: "./run.mjs", commandArgs: ["vitest"] }`),
    launcherFiles
  )
  assert.equal(r.status, 0, r.stderr)
  assert.ok(r.outputExists("./README.md"))
})

test("regression: the old broken `args` form fails (the #3 bug)", () => {
  const r = runProject(
    launcherConfig(`{ command: "./run.mjs", args: ["vitest"] }`),
    launcherFiles
  )
  assert.notEqual(
    r.status,
    0,
    "a config that builds an unrunnable command must fail"
  )
})

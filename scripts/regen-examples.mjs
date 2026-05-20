#!/usr/bin/env node
// Re-runs the CLI in each example folder so the committed OUTPUT.md
// files stay in sync with the current source.
//
// pnpm doesn't symlink a package into its own node_modules — so example
// configs that do `import 'collect-test-cases/...'` can't resolve the
// import when run from a subdirectory of this repo. This script puts a
// temporary symlink in place for the duration of the run.

import { spawnSync } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  readdirSync,
  symlinkSync,
  unlinkSync,
} from "node:fs"
import { dirname, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, "..")
const examplesRoot = resolve(repoRoot, "examples")
const distCli = resolve(repoRoot, "dist/cli/index.js")
const nodeModules = resolve(repoRoot, "node_modules")
const selfLink = resolve(nodeModules, "collect-test-cases")

const runStep = (label, bin, args) => {
  console.log(`[regen-examples] ${label}`)
  const result = spawnSync(bin, args, { cwd: repoRoot, stdio: "inherit" })

  if (result.status !== 0) {
    throw new Error(`${label} failed (exit ${result.status ?? "?"})`)
  }
}

// Build dist/ from source so the CLI we exec below reflects the current
// repo state. Spawning the local binaries directly avoids depending on
// whether pnpm/npm is on PATH inside this script's invocation.
runStep(
  "rimraf dist",
  resolve(nodeModules, ".bin/rimraf"),
  ["dist"]
)
runStep(
  "tsc -p tsconfig.build.json",
  resolve(nodeModules, ".bin/tsc"),
  ["-p", "tsconfig.build.json"]
)
runStep(
  "post-build chmod",
  process.execPath,
  [resolve(repoRoot, "scripts/post-build.js")]
)

if (!existsSync(distCli)) {
  console.error(
    `[regen-examples] ${relative(repoRoot, distCli)} is missing after build`
  )
  process.exit(1)
}

mkdirSync(nodeModules, { recursive: true })

const setupLink = () => {
  if (existsSync(selfLink)) return
  symlinkSync("..", selfLink, "dir")
}

const teardownLink = () => {
  try {
    if (existsSync(selfLink)) unlinkSync(selfLink)
  } catch {
    /* ignore */
  }
}

setupLink()
process.on("exit", teardownLink)
process.on("SIGINT", () => {
  teardownLink()
  process.exit(130)
})

// Walks the examples tree and yields every directory that owns a
// `collect-test-cases.config.mjs` (or `.js`). Examples may nest the
// config (the monorepo example puts it under `apps/myapp/`).
const findConfigDirs = (dir) => {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const child = resolve(dir, entry.name)
    if (
      entry.isFile() &&
      (entry.name === "collect-test-cases.config.mjs" ||
        entry.name === "collect-test-cases.config.js")
    ) {
      out.push(dir)
      return out
    }
    if (entry.isDirectory()) out.push(...findConfigDirs(child))
  }
  return out
}

const configDirs = []
for (const entry of readdirSync(examplesRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  configDirs.push(...findConfigDirs(resolve(examplesRoot, entry.name)))
}

if (configDirs.length === 0) {
  console.warn("[regen-examples] no example configs found")
  process.exit(0)
}

let failed = 0
for (const dir of configDirs) {
  const label = relative(examplesRoot, dir) || "."
  console.log(`[regen-examples] ${label}`)
  const result = spawnSync("node", [distCli], {
    cwd: dir,
    stdio: "inherit",
  })
  if (result.status !== 0) {
    failed += 1
    console.error(
      `[regen-examples] ${label} failed (exit ${result.status ?? "?"})`
    )
  }
}

if (failed > 0) {
  console.error(`[regen-examples] ${failed} example(s) failed`)
  process.exit(1)
}

console.log(`[regen-examples] regenerated ${configDirs.length} example(s)`)

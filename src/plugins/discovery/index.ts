import { spawnSync } from "node:child_process"

import { NAME_SEPARATOR } from "../../discovery.js"
import type {
  CollectTestCasesPlugin,
  DiscoveryResult,
} from "../../plugin.js"

// Shared options for a runner-backed discovery adapter.
export interface DiscoveryAdapterOptions {
  // Extra CLI arguments appended after the adapter's default list command.
  args?: string[]
  // Executable to run. Defaults to the runner's own name (e.g. `'vitest'`),
  // resolved on PATH. Pass an absolute path to pin a specific binary.
  command?: string
  // Working directory for the spawned process. Defaults to `ctx.root`.
  cwd?: string
  // Path to the runner config, passed through as `--config <path>`.
  configPath?: string
}

const MAX_BUFFER = 64 * 1024 * 1024

const runList = (
  command: string,
  args: string[],
  cwd: string
): { error?: string; stdout: string } => {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf-8",
    maxBuffer: MAX_BUFFER,
  })

  if (result.error) {
    return { error: String(result.error), stdout: "" }
  }

  return {
    error:
      result.status && result.status !== 0
        ? (result.stderr ?? `exited with code ${result.status}`)
        : undefined,
    stdout: result.stdout ?? "",
  }
}

// Runner output is often preceded by notices (dotenv banners, deprecation
// warnings). Scan for the first `{`/`[` that begins a parseable JSON document
// and return it. Mirrors the tolerance the Playwright file-list path already
// applies.
const extractJson = (stdout: string): unknown => {
  for (let at = 0; at < stdout.length; at++) {
    const ch = stdout[at]

    if (ch !== "{" && ch !== "[") {
      continue
    }

    try {
      return JSON.parse(stdout.slice(at))
    } catch {
      // Not the JSON document — keep scanning.
    }
  }

  return undefined
}

const fail = (name: string, message: string): never => {
  throw new Error(`[collect-test-cases:${name}] ${message}`)
}

// ---------------------------------------------------------------------------
// Vitest — `vitest list --json` prints `[{ name, file }, …]`, where `name` is
// the fully-qualified test name joined with ' > '. It includes every `it.each`
// row and every helper-created test. (`vitest list --reporter=json` is a
// different, plain-text flag — do NOT use it.)
// ---------------------------------------------------------------------------
interface VitestListEntry {
  file?: string
  name?: string
}

export const vitestDiscovery = (
  options: DiscoveryAdapterOptions = {}
): CollectTestCasesPlugin => ({
  discover: ({ root }) => {
    const command = options.command ?? "vitest"
    const args = ["list", "--json"]

    if (options.configPath) {
      args.push("--config", options.configPath)
    }

    args.push(...(options.args ?? []))

    const { error, stdout } = runList(command, args, options.cwd ?? root)
    const json = extractJson(stdout)

    if (!Array.isArray(json)) {
      return fail(
        "vitest",
        `'${command} ${args.join(" ")}' produced no parseable JSON array.\n${error ?? ""}`
      )
    }

    const results: DiscoveryResult[] = []

    for (const entry of json as VitestListEntry[]) {
      if (entry?.file && entry?.name) {
        results.push({ file: entry.file, name: entry.name })
      }
    }

    return results
  },
  name: "vitest-discovery",
})

// ---------------------------------------------------------------------------
// Jest — Jest has no pure "list names" command, so this parses the standard
// `jest --json` result shape (`testResults[].assertionResults[]`). Each
// assertion carries `ancestorTitles` + `title` + `status`; `pending`/`skipped`
// map to the skip icon, `todo` to the todo icon.
// ---------------------------------------------------------------------------
interface JestAssertion {
  ancestorTitles?: string[]
  status?: string
  title?: string
}
interface JestFileResult {
  assertionResults?: JestAssertion[]
  name?: string
  testFilePath?: string
}
interface JestJson {
  testResults?: JestFileResult[]
}

const jestModifier = (status?: string): string | undefined => {
  if (status === "pending" || status === "skipped" || status === "disabled") {
    return "skip"
  }

  if (status === "todo") {
    return "todo"
  }

  return undefined
}

export const jestDiscovery = (
  options: DiscoveryAdapterOptions = {}
): CollectTestCasesPlugin => ({
  discover: ({ root }) => {
    const command = options.command ?? "jest"
    const args = ["--json"]

    if (options.configPath) {
      args.push("--config", options.configPath)
    }

    args.push(...(options.args ?? []))

    const { error, stdout } = runList(command, args, options.cwd ?? root)
    const json = extractJson(stdout) as JestJson | undefined

    if (!json || !Array.isArray(json.testResults)) {
      return fail(
        "jest",
        `'${command} ${args.join(" ")}' produced no parseable JSON.\n${error ?? ""}`
      )
    }

    const results: DiscoveryResult[] = []

    for (const fileResult of json.testResults) {
      const file = fileResult.testFilePath ?? fileResult.name

      if (!file) {
        continue
      }

      for (const assertion of fileResult.assertionResults ?? []) {
        if (!assertion.title) {
          continue
        }

        const name = [...(assertion.ancestorTitles ?? []), assertion.title].join(
          NAME_SEPARATOR
        )
        const modifier = jestModifier(assertion.status)

        results.push(modifier ? { file, modifier, name } : { file, name })
      }
    }

    return results
  },
  name: "jest-discovery",
})

// ---------------------------------------------------------------------------
// Playwright — `playwright test --list --reporter=json` returns nested suites.
// The outermost suite per file carries the file path (not a describe); nested
// suites are describe blocks; each `spec.title` is a test title.
// ---------------------------------------------------------------------------
interface PlaywrightSpec {
  file?: string
  title?: string
}
interface PlaywrightSuite {
  file?: string
  specs?: PlaywrightSpec[]
  suites?: PlaywrightSuite[]
  title?: string
}
interface PlaywrightJson {
  suites?: PlaywrightSuite[]
}

export const playwrightDiscovery = (
  options: DiscoveryAdapterOptions = {}
): CollectTestCasesPlugin => ({
  discover: ({ root }) => {
    const command = options.command ?? "playwright"
    const args = ["test", "--list", "--reporter=json"]

    if (options.configPath) {
      args.push("--config", options.configPath)
    }

    args.push(...(options.args ?? []))

    const { error, stdout } = runList(command, args, options.cwd ?? root)
    const json = extractJson(stdout) as PlaywrightJson | undefined

    if (!json || !Array.isArray(json.suites)) {
      return fail(
        "playwright",
        `'${command} ${args.join(" ")}' produced no parseable JSON.\n${error ?? ""}`
      )
    }

    const results: DiscoveryResult[] = []

    const walk = (
      suite: PlaywrightSuite,
      describes: string[],
      inheritedFile: string | undefined
    ): void => {
      const file = suite.file ?? inheritedFile

      for (const spec of suite.specs ?? []) {
        const specFile = spec.file ?? file

        if (specFile && spec.title) {
          results.push({
            file: specFile,
            name: [...describes, spec.title].join(NAME_SEPARATOR),
          })
        }
      }

      for (const sub of suite.suites ?? []) {
        walk(sub, [...describes, sub.title ?? ""], file)
      }
    }

    // Top-level suites are file suites: their title is the file path, not a
    // describe, so it is not added to the `describes` chain.
    for (const fileSuite of json.suites) {
      walk(fileSuite, [], fileSuite.file)
    }

    return results
  },
  name: "playwright-discovery",
})

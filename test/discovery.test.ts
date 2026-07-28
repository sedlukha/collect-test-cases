import assert from "node:assert/strict"
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, test } from "node:test"

import {
  discoveryResultsToCases,
  NAME_SEPARATOR,
  runDiscovery,
} from "../src/discovery.js"
import type { DiscoveryResult } from "../src/plugin.js"
import {
  jestDiscovery,
  playwrightDiscovery,
  vitestDiscovery,
} from "../src/plugins/discovery/index.js"

let tmpDir: string

beforeEach(() => {
  tmpDir = join(tmpdir(), `ctc-discovery-${Date.now()}-${Math.random()}`)
  mkdirSync(tmpDir, { recursive: true })
})

afterEach(() => {
  rmSync(tmpDir, { force: true, recursive: true })
})

// Writes an executable fake runner CLI that prints `stdout` verbatim.
const writeFakeCli = (name: string, stdout: string): string => {
  const p = join(tmpDir, name)
  writeFileSync(
    p,
    `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(stdout)})\n`
  )
  chmodSync(p, 0o755)

  return p
}

describe("discoveryResultsToCases", () => {
  test("splits a flat ' > ' name into describes + title", () => {
    const results: DiscoveryResult[] = [
      { file: "/abs/a.test.ts", name: "outer > inner > does a thing" },
    ]
    const byFile = discoveryResultsToCases(results, "/abs")
    const cases = byFile.get("/abs/a.test.ts")
    assert.equal(cases?.length, 1)
    assert.deepEqual(cases?.[0]?.describes, ["outer", "inner"])
    assert.equal(cases?.[0]?.title, "does a thing")
  })

  test("a name with no separator becomes a title with empty describes", () => {
    const byFile = discoveryResultsToCases(
      [{ file: "/abs/a.test.ts", name: "just a title" }],
      "/abs"
    )
    const cases = byFile.get("/abs/a.test.ts")
    assert.deepEqual(cases?.[0]?.describes, [])
    assert.equal(cases?.[0]?.title, "just a title")
  })

  test("resolves relative file paths against root and groups by file", () => {
    const byFile = discoveryResultsToCases(
      [
        { file: "sub/a.test.ts", name: "one" },
        { file: "sub/a.test.ts", name: "two" },
      ],
      "/root"
    )
    assert.deepEqual([...byFile.keys()], ["/root/sub/a.test.ts"])
    assert.equal(byFile.get("/root/sub/a.test.ts")?.length, 2)
  })

  test("maps a known modifier and drops an unknown one", () => {
    const byFile = discoveryResultsToCases(
      [
        { file: "/a.ts", modifier: "skip", name: "x" },
        { file: "/a.ts", modifier: "run", name: "y" },
      ],
      "/"
    )
    const cases = byFile.get("/a.ts")
    assert.equal(cases?.[0]?.modifier, "skip")
    assert.equal(cases?.[1]?.modifier, undefined)
  })
})

describe("runDiscovery", () => {
  test("returns null when no plugin implements discover()", async () => {
    const out = await runDiscovery([{ name: "noop" }], "/root")
    assert.equal(out, null)
  })

  test("merges results from every discover() hook", async () => {
    const out = await runDiscovery(
      [
        { discover: () => [{ file: "a.ts", name: "one" }], name: "p1" },
        {
          discover: async () => [{ file: "b.ts", name: "two" }],
          name: "p2",
        },
      ],
      "/root"
    )
    assert.deepEqual(out, [
      { file: "a.ts", name: "one" },
      { file: "b.ts", name: "two" },
    ])
  })

  test("a plugin returning null opts out without forcing runtime mode", async () => {
    const out = await runDiscovery(
      [{ discover: () => null, name: "p1" }],
      "/root"
    )
    assert.equal(out, null)
  })
})

describe("vitestDiscovery adapter", () => {
  test("parses `vitest list --json` output", () => {
    const listJson = JSON.stringify([
      { file: `${tmpDir}/a.test.ts`, name: "group > runs a" },
      { file: `${tmpDir}/a.test.ts`, name: "group > runs b" },
    ])
    const cli = writeFakeCli("fake-vitest.mjs", `noise line\n${listJson}\n`)
    const plugin = vitestDiscovery({ command: cli })
    const results = plugin.discover?.({ root: tmpDir })
    assert.deepEqual(results, [
      { file: `${tmpDir}/a.test.ts`, name: "group > runs a" },
      { file: `${tmpDir}/a.test.ts`, name: "group > runs b" },
    ])
  })

  test("throws a helpful error when no JSON array is produced", () => {
    const cli = writeFakeCli("fake-vitest-bad.mjs", "not json at all\n")
    const plugin = vitestDiscovery({ command: cli })
    assert.throws(
      () => plugin.discover?.({ root: tmpDir }),
      /vitest.*no parseable JSON array/s
    )
  })
})

describe("jestDiscovery adapter", () => {
  test("parses standard `jest --json` assertionResults with statuses", () => {
    const jestJson = JSON.stringify({
      testResults: [
        {
          assertionResults: [
            { ancestorTitles: ["Suite"], status: "passed", title: "does x" },
            { ancestorTitles: ["Suite"], status: "pending", title: "skips y" },
            { ancestorTitles: [], status: "todo", title: "todo z" },
          ],
          testFilePath: `${tmpDir}/a.test.ts`,
        },
      ],
    })
    const cli = writeFakeCli("fake-jest.mjs", jestJson)
    const plugin = jestDiscovery({ command: cli })
    const results = plugin.discover?.({ root: tmpDir })
    assert.deepEqual(results, [
      { file: `${tmpDir}/a.test.ts`, name: "Suite > does x" },
      { file: `${tmpDir}/a.test.ts`, modifier: "skip", name: "Suite > skips y" },
      { file: `${tmpDir}/a.test.ts`, modifier: "todo", name: "todo z" },
    ])
  })
})

describe("playwrightDiscovery adapter", () => {
  test("builds names from nested suites, excluding the file-level title", () => {
    const listJson = JSON.stringify({
      config: { rootDir: tmpDir },
      suites: [
        {
          file: "a.spec.ts",
          specs: [{ file: "a.spec.ts", title: "top-level test" }],
          suites: [
            {
              file: "a.spec.ts",
              specs: [{ file: "a.spec.ts", title: "nested test" }],
              title: "describe block",
            },
          ],
          title: "a.spec.ts",
        },
      ],
    })
    const cli = writeFakeCli("fake-pw.mjs", listJson)
    const plugin = playwrightDiscovery({ command: cli })
    const results = plugin.discover?.({ root: tmpDir })
    assert.deepEqual(results, [
      { file: "a.spec.ts", name: "top-level test" },
      { file: "a.spec.ts", name: `describe block${NAME_SEPARATOR}nested test` },
    ])
  })
})

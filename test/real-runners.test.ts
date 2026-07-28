import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, rmSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { afterEach, beforeEach, describe, test } from "node:test"

import { applyConfigDefaults } from "../src/config.js"
import {
  discoveryResultsToCases,
  reconcileDiscovery,
} from "../src/discovery.js"
import { collectSpecFiles, groupSpecs } from "../src/grouper.js"
import type { GroupedSpecs } from "../src/grouper.js"
import {
  jestDiscovery,
  vitestDiscovery,
} from "../src/plugins/discovery/index.js"

// These tests spawn REAL Vitest and Jest against fixtures. They exist to test
// the boundary this package does not own: what a runner actually reports back,
// not just what the adapter sends it. A fake runner can't catch a name-split,
// dedup, or collection-vs-run bug — a real spawn can.

const fromHere = (rel: string): string =>
  fileURLToPath(new URL(rel, import.meta.url))

const bin = (name: string): string => fromHere(`../node_modules/.bin/${name}`)

const MAX_BUFFER = 64 * 1024 * 1024

const countCases = (grouped: GroupedSpecs): number =>
  [...grouped.values()]
    .flatMap((c) => [...c.values()])
    .flatMap((p) => [...p.values()])
    .flat().length

// Runs the full adapter → cases → group pipeline for a fixture and returns the
// tool's test count (the adapter is the source of truth, so the spec set is
// exactly what it reported).
const toolCount = (
  plugin: ReturnType<typeof vitestDiscovery>,
  fixtureDir: string
): number => {
  const results = plugin.discover?.({ root: fixtureDir })
  assert.ok(Array.isArray(results), "adapter returned no results")
  const casesByFile = discoveryResultsToCases(results, fixtureDir)
  const config = applyConfigDefaults({
    rootDir: fixtureDir,
    scanDirs: [fixtureDir],
  })
  const grouped = groupSpecs([...casesByFile.keys()], config, casesByFile)

  return countCases(grouped)
}

describe("real vitest runner", () => {
  const fixtureDir = fromHere("fixtures/vitest-suite")

  test("tool count === `vitest list --json` count", () => {
    const raw = spawnSync(bin("vitest"), ["list", "--json"], {
      cwd: fixtureDir,
      encoding: "utf-8",
      maxBuffer: MAX_BUFFER,
    })
    const stdout = raw.stdout ?? ""
    const rawCount = (
      JSON.parse(stdout.slice(stdout.indexOf("["))) as unknown[]
    ).length

    // Sanity: the fixture is non-trivial (it.each rows + helper + describe.each).
    assert.ok(rawCount >= 8, `expected a real suite, got ${rawCount}`)

    assert.equal(
      toolCount(vitestDiscovery({ command: bin("vitest"), cwd: fixtureDir }), fixtureDir),
      rawCount
    )
  })
})

describe("discovery/include mismatch, both directions (real vitest fixture)", () => {
  const fixtureDir = fromHere("fixtures/vitest-suite")

  // Real adapter output + real glob, so the file paths on both sides are the
  // ones the runner and the globber actually produce.
  const setup = () => {
    const config = applyConfigDefaults({
      include: ["*.test.ts"],
      rootDir: fixtureDir,
      scanDirs: [fixtureDir],
    })
    const results = vitestDiscovery({
      command: bin("vitest"),
      cwd: fixtureDir,
    }).discover?.({ root: fixtureDir })
    assert.ok(Array.isArray(results))
    const casesByFile = discoveryResultsToCases(results, fixtureDir)
    const globbed = collectSpecFiles(config)

    return { casesByFile, globbed }
  }

  test("adapter narrower than include → the extra file is skipped, not parsed", () => {
    const { casesByFile, globbed } = setup()
    assert.ok(globbed.length >= 3)

    // Simulate an adapter that missed one file the glob matched.
    const dropped = globbed[0] as string
    const narrower = new Map(casesByFile)
    narrower.delete(dropped)

    const rec = reconcileDiscovery(globbed, narrower, "skip")
    assert.ok(rec.skipped.includes(dropped))
    assert.ok(!rec.specFiles.includes(dropped))
  })

  test("adapter wider than include → adapter wins, nothing skipped", () => {
    const { casesByFile, globbed } = setup()

    // Narrow include to a single file; the adapter still reported all of them.
    const narrowInclude = [globbed[0] as string]
    const rec = reconcileDiscovery(narrowInclude, casesByFile, "skip")

    assert.equal(rec.skipped.length, 0)
    assert.equal(rec.specFiles.length, casesByFile.size)
  })
})

describe("real jest runner", () => {
  const fixtureDir = fromHere("fixtures/jest-suite")
  const marker = fromHere("fixtures/jest-suite/RAN.marker")

  beforeEach(() => rmSync(marker, { force: true }))
  afterEach(() => rmSync(marker, { force: true }))

  test("tool count === `jest --collectTests --json` count", () => {
    const raw = spawnSync(bin("jest"), ["--collectTests", "--json"], {
      cwd: fixtureDir,
      encoding: "utf-8",
      maxBuffer: MAX_BUFFER,
    })
    const stdout = raw.stdout ?? ""
    const parsed = JSON.parse(stdout.slice(stdout.indexOf("{"))) as {
      testResults: { assertionResults: unknown[] }[]
    }
    const rawCount = parsed.testResults.reduce(
      (n, f) => n + f.assertionResults.length,
      0
    )
    assert.ok(rawCount >= 10, `expected a real suite, got ${rawCount}`)

    assert.equal(
      toolCount(jestDiscovery({ command: bin("jest"), cwd: fixtureDir }), fixtureDir),
      rawCount
    )
  })

  test("collect mode does NOT run test bodies; run mode does (side effect)", () => {
    // Behavioural, not argv-based: the fixture writes RAN.marker only when a
    // test body executes.
    assert.ok(!existsSync(marker), "marker should start absent")

    jestDiscovery({ command: bin("jest"), cwd: fixtureDir }).discover?.({
      root: fixtureDir,
    })
    assert.ok(
      !existsSync(marker),
      "collect mode must not execute test bodies"
    )

    jestDiscovery({
      command: bin("jest"),
      cwd: fixtureDir,
      mode: "run",
    }).discover?.({ root: fixtureDir })
    assert.ok(existsSync(marker), "run mode must execute test bodies")
  })
})

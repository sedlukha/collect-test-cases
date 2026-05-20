import assert from "node:assert/strict"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, test } from "node:test"

import { applyConfigDefaults } from "../src/config.js"
import { collectSpecFiles, groupSpecs } from "../src/grouper.js"
import {
  type AppDomains,
  generateAppMarkdown,
  parseSpecFile,
} from "../src/index.js"

let tmpDir: string

beforeEach(() => {
  tmpDir = join(tmpdir(), `collect-test-cases-${Date.now()}-${Math.random()}`)
  mkdirSync(tmpDir, { recursive: true })
})

afterEach(() => {
  rmSync(tmpDir, {
    force: true,
    recursive: true,
  })
})

const writeTmp = (name: string, content: string): string => {
  const p = join(tmpDir, name)
  writeFileSync(p, content, "utf-8")

  return p
}

const renderApp = (
  appName: string,
  domains: AppDomains,
  opts: {
    config?: Parameters<typeof generateAppMarkdown>[0]["config"]
    outputDir?: string
  } = {}
): string =>
  generateAppMarkdown({
    appName,
    config: opts.config,
    domains,
    outputDir: opts.outputDir ?? tmpDir,
    root: tmpDir,
  })

const localesPlugin = (locales: string[]) => ({
  name: "test-locales",
  screenshotLocales: () => locales,
})

const sampleSpecTypes = {
  auth: {
    label: "🔐 Auth",
    order: 1,
    pattern: ".auth.",
  },
  guest: {
    label: "👥 Guest",
    order: 0,
    pattern: ".guest.",
  },
  screenshot: {
    gallery: true,
    label: "📸 Visual",
    order: 2,
    pattern: ".screenshot.",
  },
  unknown: {
    label: "🧪 Other",
    order: 5,
  },
}

describe("parseSpecFile", () => {
  test("extracts a bare test() title", () => {
    const p = writeTmp(
      "simple.spec.ts",
      `
test('should do something', async () => {})
`
    )
    const cases = parseSpecFile(p)
    assert.equal(cases.length, 1)
    assert.equal(cases[0]?.title, "should do something")
    assert.deepEqual(cases[0]?.describes, [])
  })

  test("extracts a bare it() title", () => {
    const p = writeTmp(
      "it.spec.ts",
      `
it('renders correctly', () => {})
`
    )
    const cases = parseSpecFile(p)
    assert.equal(cases.length, 1)
    assert.equal(cases[0]?.title, "renders correctly")
  })

  test("extracts test inside test.describe and tracks describe name", () => {
    const p = writeTmp(
      "describe.spec.ts",
      `
test.describe('MyPage', () => {
  test('should render', async () => {})
})
`
    )
    const cases = parseSpecFile(p)
    assert.equal(cases.length, 1)
    assert.deepEqual(cases[0]?.describes, ["MyPage"])
    assert.equal(cases[0]?.title, "should render")
  })

  test("does NOT extract test.step as a test case but collects it as a step", () => {
    const p = writeTmp(
      "step.spec.ts",
      `
test('outer test', async ({ page }) => {
  await test.step('click button', async () => {})
})
`
    )
    const cases = parseSpecFile(p)
    assert.equal(cases.length, 1)
    assert.equal(cases[0]?.title, "outer test")
    assert.deepEqual(cases[0]?.steps, ["click button"])
  })

  test("does NOT extract test.beforeEach as a test case", () => {
    const p = writeTmp(
      "hooks.spec.ts",
      `
test.beforeEach(async () => {})
test('actual test', async () => {})
`
    )
    const cases = parseSpecFile(p)
    assert.equal(cases.length, 1)
    assert.equal(cases[0]?.title, "actual test")
  })

  test("pops describe stack correctly after closing brace", () => {
    const p = writeTmp(
      "nested.spec.ts",
      `
test.describe('Outer', () => {
  test('inside outer', async () => {})
})
test('outside', async () => {})
`
    )
    const cases = parseSpecFile(p)
    assert.equal(cases.length, 2)
    assert.deepEqual(cases[0]?.describes, ["Outer"])
    assert.deepEqual(cases[1]?.describes, [])
  })

  test("handles nested describes", () => {
    const p = writeTmp(
      "nested-describe.spec.ts",
      `
test.describe('Outer', () => {
  test.describe('Inner', () => {
    test('deep test', async () => {})
  })
})
`
    )
    const cases = parseSpecFile(p)
    assert.equal(cases.length, 1)
    assert.deepEqual(cases[0]?.describes, ["Outer", "Inner"])
    assert.equal(cases[0]?.title, "deep test")
  })

  test("returns empty array for file with no tests", () => {
    const p = writeTmp(
      "empty.spec.ts",
      `
// no tests here
const x = 1
`
    )
    const cases = parseSpecFile(p)
    assert.equal(cases.length, 0)
  })

  test("extracts test with title on next line", () => {
    const p = writeTmp(
      "multiline.spec.ts",
      `
test(
  'should work', async () => {}
)
`
    )
    const cases = parseSpecFile(p)
    assert.equal(cases.length, 1)
    assert.equal(cases[0]?.title, "should work")
  })

  test("collects test.step() names from test body", () => {
    const p = writeTmp(
      "steps.spec.ts",
      `
test('should do something', async ({ page }) => {
  await test.step('navigate to the page', async () => {
    await page.goto('/')
  })
  await test.step('verify heading is visible', async () => {
    await expect(page.locator('h1')).toBeVisible()
  })
})
`
    )
    const cases = parseSpecFile(p)
    assert.equal(cases.length, 1)
    assert.deepEqual(cases[0]?.steps, [
      "navigate to the page",
      "verify heading is visible",
    ])
  })

  test("collects test.step() names using double-quote strings", () => {
    const p = writeTmp(
      "steps-dq.spec.ts",
      `
test('should do something', async ({ page }) => {
  await test.step("fill the form", async () => {})
  await test.step("submit and verify", async () => {})
})
`
    )
    const cases = parseSpecFile(p)
    assert.equal(cases.length, 1)
    assert.deepEqual(cases[0]?.steps, ["fill the form", "submit and verify"])
  })

  test("returns empty steps when no test.step() calls", () => {
    const p = writeTmp(
      "no-steps.spec.ts",
      `
test('bare test', async () => {
  expect(true).toBe(true)
})
`
    )
    const cases = parseSpecFile(p)
    assert.deepEqual(cases[0]?.steps, [])
  })

  test("extracts test inside bare describe() (Jest/Mocha style)", () => {
    const p = writeTmp(
      "bare-describe.spec.ts",
      `
describe('Outer', () => {
  it('inner test', () => {})
})
`
    )
    const cases = parseSpecFile(p)
    assert.equal(cases.length, 1)
    assert.deepEqual(cases[0]?.describes, ["Outer"])
    assert.equal(cases[0]?.title, "inner test")
  })

  test("extracts test.skip / test.only / test.fixme as test cases", () => {
    const p = writeTmp(
      "modifiers.spec.ts",
      `
test.skip('skipped one', () => {})
test.only('only one', () => {})
it.fixme('fixme one', () => {})
`
    )
    const cases = parseSpecFile(p)
    assert.deepEqual(
      cases.map((c) => c.title),
      ["skipped one", "only one", "fixme one"]
    )
  })

  test("extracts describe.only / describe.skip", () => {
    const p = writeTmp(
      "describe-only.spec.ts",
      `
describe.only('Focused', () => {
  test('inside focused', () => {})
})
describe.skip('Skipped', () => {
  test('inside skipped', () => {})
})
`
    )
    const cases = parseSpecFile(p)
    assert.equal(cases.length, 2)
    assert.deepEqual(cases[0]?.describes, ["Focused"])
    assert.deepEqual(cases[1]?.describes, ["Skipped"])
  })

  test("still ignores test.describe() and test.step() as test cases", () => {
    const p = writeTmp(
      "ignore.spec.ts",
      `
test.describe('Group', () => {
  test('real', async () => {
    await test.step('a step', async () => {})
  })
})
`
    )
    const cases = parseSpecFile(p)
    assert.equal(cases.length, 1)
    assert.equal(cases[0]?.title, "real")
    assert.deepEqual(cases[0]?.steps, ["a step"])
  })

  test("normalises multi-line test.skip(\\n title) calls", () => {
    const p = writeTmp(
      "multiline-skip.spec.ts",
      `
test.skip(
  'should be skipped', async () => {}
)
`
    )
    const cases = parseSpecFile(p)
    assert.equal(cases.length, 1)
    assert.equal(cases[0]?.title, "should be skipped")
  })
})

describe("layout-derived resolvers", () => {
  test("resolveApp matches spec inside appsDir/<NAME>", () => {
    const resolved = applyConfigDefaults({
      appName: "QUIZBASE",
      layout: { appsDir: "apps" },
      rootDir: tmpDir,
    })
    const specPath = join(tmpDir, "apps/QUIZBASE/web/__checks__/Foo.spec.ts")
    assert.deepEqual(resolved.resolveApp?.(specPath, tmpDir), {})
  })

  test("resolveApp excludes specs inside other apps", () => {
    const resolved = applyConfigDefaults({
      appName: "QUIZBASE",
      layout: { appsDir: "apps" },
      rootDir: tmpDir,
    })
    const specPath = join(tmpDir, "apps/BRANDWEIGHT/web/__checks__/Foo.spec.ts")
    assert.equal(resolved.resolveApp?.(specPath, tmpDir), null)
  })

  test("resolveApp falls back to playwright.config.ts for shared specs", () => {
    const e2eDir = join(tmpDir, "packages/routes/auth/e2e")
    const checksDir = join(e2eDir, "__checks__")
    mkdirSync(checksDir, { recursive: true })
    writeFileSync(
      join(e2eDir, "playwright.config.ts"),
      "export default { use: { appName: ['QUIZBASE', 'BRANDWEIGHT'] } }",
      "utf-8"
    )
    writeFileSync(join(checksDir, "login.spec.ts"), "", "utf-8")

    const resolved = applyConfigDefaults({
      appName: "QUIZBASE",
      layout: { appsDir: "apps", sharedSpecs: {} },
      rootDir: tmpDir,
    })
    const specPath = join(checksDir, "login.spec.ts")
    assert.deepEqual(resolved.resolveApp?.(specPath, tmpDir), {
      sharedAcrossApps: true,
    })
  })

  test("resolveApp sets sharedAcrossApps=false for single-string appName", () => {
    const e2eDir = join(tmpDir, "packages/routes/auth/e2e")
    const checksDir = join(e2eDir, "__checks__")
    mkdirSync(checksDir, { recursive: true })
    writeFileSync(
      join(e2eDir, "playwright.config.ts"),
      "export default { use: { appName: 'QUIZBASE' } }",
      "utf-8"
    )
    writeFileSync(join(checksDir, "login.spec.ts"), "", "utf-8")

    const resolved = applyConfigDefaults({
      appName: "QUIZBASE",
      layout: { appsDir: "apps", sharedSpecs: {} },
      rootDir: tmpDir,
    })
    const specPath = join(checksDir, "login.spec.ts")
    assert.deepEqual(resolved.resolveApp?.(specPath, tmpDir), {
      sharedAcrossApps: false,
    })
  })

  test("resolveApp returns null when playwright.config.ts is missing", () => {
    const checksDir = join(tmpDir, "packages/routes/auth/e2e/__checks__")
    mkdirSync(checksDir, { recursive: true })
    writeFileSync(join(checksDir, "login.spec.ts"), "", "utf-8")

    const resolved = applyConfigDefaults({
      appName: "QUIZBASE",
      layout: { appsDir: "apps", sharedSpecs: {} },
      rootDir: tmpDir,
    })
    const specPath = join(checksDir, "login.spec.ts")
    assert.equal(resolved.resolveApp?.(specPath, tmpDir), null)
  })

  test("resolveApp returns null when app is not listed in shared playwright config", () => {
    const e2eDir = join(tmpDir, "packages/routes/auth/e2e")
    const checksDir = join(e2eDir, "__checks__")
    mkdirSync(checksDir, { recursive: true })
    writeFileSync(
      join(e2eDir, "playwright.config.ts"),
      "export default { use: { appName: ['BRANDWEIGHT'] } }",
      "utf-8"
    )
    writeFileSync(join(checksDir, "login.spec.ts"), "", "utf-8")

    const resolved = applyConfigDefaults({
      appName: "QUIZBASE",
      layout: { appsDir: "apps", sharedSpecs: {} },
      rootDir: tmpDir,
    })
    const specPath = join(checksDir, "login.spec.ts")
    assert.equal(resolved.resolveApp?.(specPath, tmpDir), null)
  })

  test("resolveDomain extracts segment after routesDir", () => {
    const resolved = applyConfigDefaults({
      appName: "QUIZBASE",
      layout: { appsDir: "apps", routesDir: "packages/routes" },
      rootDir: tmpDir,
    })
    const specPath = join(
      tmpDir,
      "packages/routes/auth/web/__checks__/login.spec.ts"
    )
    assert.equal(resolved.resolveDomain?.(specPath, tmpDir), "auth")
  })

  test("resolveDomain is undefined when routesDir is omitted", () => {
    const resolved = applyConfigDefaults({
      appName: "QUIZBASE",
      layout: { appsDir: "apps" },
      rootDir: tmpDir,
    })
    assert.equal(resolved.resolveDomain, undefined)
  })

  test("resolveCategory extracts segment after categoryAnchor", () => {
    const resolved = applyConfigDefaults({
      appName: "QUIZBASE",
      layout: { appsDir: "apps", categoryAnchor: "packages" },
      rootDir: tmpDir,
    })
    const specPath = join(
      tmpDir,
      "apps/QUIZBASE/web/packages/pages/home/__checks__/home.spec.ts"
    )
    assert.equal(resolved.resolveCategory?.(specPath, tmpDir), "pages")
  })

  test("explicit resolveApp overrides layout-derived resolver", () => {
    const explicit = () => ({ sharedAcrossApps: true })
    const resolved = applyConfigDefaults({
      appName: "QUIZBASE",
      layout: { appsDir: "apps" },
      resolveApp: explicit,
      rootDir: tmpDir,
    })
    assert.equal(resolved.resolveApp, explicit)
  })
})

describe("collectSpecFiles", () => {
  test("default include picks up specs under __checks__", () => {
    mkdirSync(join(tmpDir, "src/__checks__/HomePage"), { recursive: true })
    writeFileSync(join(tmpDir, "src/__checks__/HomePage/Home.spec.ts"), "")
    writeFileSync(join(tmpDir, "src/__checks__/flat.spec.ts"), "")
    writeFileSync(join(tmpDir, "src/not-a-spec.ts"), "")

    const resolved = applyConfigDefaults({
      rootDir: tmpDir,
      scanDirs: [tmpDir],
    })
    const found = collectSpecFiles(resolved)
    assert.deepEqual(found.sort(), [
      join(tmpDir, "src/__checks__/HomePage/Home.spec.ts"),
      join(tmpDir, "src/__checks__/flat.spec.ts"),
    ])
  })

  test("default exclude skips __screenshots__ and node_modules", () => {
    mkdirSync(join(tmpDir, "src/__checks__/__screenshots__"), {
      recursive: true,
    })
    mkdirSync(join(tmpDir, "node_modules/pkg/__checks__"), { recursive: true })
    writeFileSync(join(tmpDir, "src/__checks__/keep.spec.ts"), "")
    writeFileSync(
      join(tmpDir, "src/__checks__/__screenshots__/skip.spec.ts"),
      ""
    )
    writeFileSync(join(tmpDir, "node_modules/pkg/__checks__/skip.spec.ts"), "")

    const resolved = applyConfigDefaults({
      rootDir: tmpDir,
      scanDirs: [tmpDir],
    })
    const found = collectSpecFiles(resolved)
    assert.deepEqual(found, [join(tmpDir, "src/__checks__/keep.spec.ts")])
  })

  test("custom include matches any extension/convention", () => {
    mkdirSync(join(tmpDir, "tests"), { recursive: true })
    writeFileSync(join(tmpDir, "tests/login.e2e.ts"), "")
    writeFileSync(join(tmpDir, "tests/skip.test.ts"), "")

    const resolved = applyConfigDefaults({
      include: ["tests/*.e2e.ts"],
      rootDir: tmpDir,
      scanDirs: [tmpDir],
    })
    const found = collectSpecFiles(resolved)
    assert.deepEqual(found, [join(tmpDir, "tests/login.e2e.ts")])
  })

  test("specType.pattern accepts RegExp", () => {
    mkdirSync(join(tmpDir, "src/__checks__"), { recursive: true })
    const authSpec = join(tmpDir, "src/__checks__/page.auth.spec.ts")
    const providerSpec = join(tmpDir, "src/__checks__/page.provider.spec.ts")
    const otherSpec = join(tmpDir, "src/__checks__/page.smoke.spec.ts")
    writeFileSync(authSpec, "test('a', () => {})")
    writeFileSync(providerSpec, "test('b', () => {})")
    writeFileSync(otherSpec, "test('c', () => {})")

    const resolved = applyConfigDefaults({
      rootDir: tmpDir,
      scanDirs: [tmpDir],
      specTypes: {
        gated: { label: "Gated", order: 0, pattern: /\.(auth|provider)\./ },
        other: { label: "Other", order: 100 },
      },
    })
    const grouped = groupSpecs(collectSpecFiles(resolved), resolved)
    const allCases = [...grouped.values()]
      .flatMap((c) => [...c.values()])
      .flatMap((p) => [...p.values()])
      .flat()
    const byPath = new Map(allCases.map((c) => [c.specPath, c.specType]))
    assert.equal(byPath.get("src/__checks__/page.auth.spec.ts"), "gated")
    assert.equal(byPath.get("src/__checks__/page.provider.spec.ts"), "gated")
    assert.equal(byPath.get("src/__checks__/page.smoke.spec.ts"), "other")
  })

  test("custom exclude filters matches after include", () => {
    mkdirSync(join(tmpDir, "src/__checks__/fixtures"), { recursive: true })
    writeFileSync(join(tmpDir, "src/__checks__/keep.spec.ts"), "")
    writeFileSync(join(tmpDir, "src/__checks__/fixtures/skip.spec.ts"), "")

    const resolved = applyConfigDefaults({
      exclude: ["**/fixtures/**"],
      rootDir: tmpDir,
      scanDirs: [tmpDir],
    })
    const found = collectSpecFiles(resolved)
    assert.deepEqual(found, [join(tmpDir, "src/__checks__/keep.spec.ts")])
  })
})

describe("generateAppMarkdown", () => {
  test("generates correct per-app markdown structure", () => {
    const domains: AppDomains = new Map([
      [
        "",
        new Map([
          [
            "FlashCardPage",
            new Map([
              [
                "FlashCardPage",
                [
                  {
                    describes: ["FlashCardPage"],
                    pageName: "FlashCardPage",
                    specPath:
                      "apps/quizbase/__checks__/FlashCardPage/FlashCardPage.guest.spec.ts",
                    specType: "guest",
                    steps: [],
                    title: "should return 200 status",
                  },
                  {
                    describes: ["FlashCardPage"],
                    pageName: "FlashCardPage",
                    specPath:
                      "apps/quizbase/__checks__/FlashCardPage/FlashCardPage.guest.spec.ts",
                    specType: "guest",
                    steps: [],
                    title: "should return correct meta",
                  },
                ],
              ],
            ]),
          ],
        ]),
      ],
    ])

    const md = renderApp("quizbase", domains, {
      config: { specTypes: sampleSpecTypes },
    })

    assert.ok(md.includes("# quizbase Test Cases"))
    assert.ok(md.includes("_Auto-generated. Do not edit manually._"))
    assert.ok(md.includes("**2 tests**"))
    assert.ok(!md.includes("<strong>quizbase</strong>"))
    assert.ok(md.includes("<strong>FlashCardPage</strong> (2 tests)"))
    assert.ok(
      md.includes("<summary><strong>👥 Guest</strong> (2 tests)</summary>")
    )
    assert.ok(md.includes("<summary>☑️ should return 200 status</summary>"))
    assert.ok(md.includes("<summary>☑️ should return correct meta</summary>"))
  })

  test("renders test count totals", () => {
    const domains: AppDomains = new Map([
      [
        "",
        new Map([
          [
            "unknown",
            new Map([
              [
                "root",
                [
                  {
                    describes: [],
                    pageName: "root",
                    specPath: "apps/myapp/__checks__/root.spec.ts",
                    specType: "default",
                    steps: [],
                    title: "test one",
                  },
                  {
                    describes: [],
                    pageName: "root",
                    specPath: "apps/myapp/__checks__/root.spec.ts",
                    specType: "default",
                    steps: [],
                    title: "test two",
                  },
                  {
                    describes: [],
                    pageName: "root",
                    specPath: "apps/myapp/__checks__/root.spec.ts",
                    specType: "default",
                    steps: [],
                    title: "test three",
                  },
                ],
              ],
            ]),
          ],
        ]),
      ],
    ])

    const md = renderApp("myapp", domains)
    assert.ok(md.includes("**3 tests**"))
    assert.ok(md.includes("<strong>root</strong> (3 tests)"))
    assert.ok(
      md.includes("<summary><strong>Tests</strong> (3 tests)</summary>")
    )
    assert.ok(md.includes("<summary>☑️ test one</summary>"))
    assert.ok(md.includes("<summary>☑️ test two</summary>"))
    assert.ok(md.includes("<summary>☑️ test three</summary>"))
  })

  test("uses no describe prefix when describes array is empty", () => {
    const domains: AppDomains = new Map([
      [
        "",
        new Map([
          [
            "unknown",
            new Map([
              [
                "bare",
                [
                  {
                    describes: [],
                    pageName: "bare",
                    specPath: "apps/app/__checks__/bare.spec.ts",
                    specType: "default",
                    steps: [],
                    title: "bare test title",
                  },
                ],
              ],
            ]),
          ],
        ]),
      ],
    ])

    const md = renderApp("app", domains)
    assert.ok(md.includes("<summary>☑️ bare test title</summary>"))
    assert.ok(!md.includes("☑️  > bare test title"))
  })

  test("renders only header when no domains have tests", () => {
    const md = renderApp("emptyapp", new Map())
    assert.ok(md.includes("# emptyapp Test Cases"))
    assert.ok(md.includes("**0 tests**"))
    assert.ok(!md.includes("<details>"))
  })

  test("renders inline screenshot gallery for Visual spec type", () => {
    const specDir = join(tmpDir, "apps/myapp/__checks__/HomePage")
    mkdirSync(specDir, { recursive: true })
    writeFileSync(
      join(specDir, "HomePage.screenshot.spec.ts"),
      `test('should match visual snapshot', async ({ page }) => {
  await expect(page).toHaveScreenshot("home-page.png")
})`,
      "utf-8"
    )

    const domains: AppDomains = new Map([
      [
        "",
        new Map([
          [
            "HomePage",
            new Map([
              [
                "HomePage",
                [
                  {
                    describes: ["HomePage"],
                    pageName: "HomePage",
                    specPath:
                      "apps/myapp/__checks__/HomePage/HomePage.screenshot.spec.ts",
                    specType: "screenshot",
                    steps: [],
                    title: "should match visual snapshot",
                  },
                ],
              ],
            ]),
          ],
        ]),
      ],
    ])

    const md = renderApp("myapp", domains, {
      config: {
        plugins: [localesPlugin(["en"])],
        specTypes: sampleSpecTypes,
      },
    })
    assert.ok(md.includes("<summary>📸 screenshots</summary>"))
    assert.ok(!md.includes("<summary>📸 screenshots ("))
    assert.ok(md.includes("**home-page**"))
    assert.ok(md.includes("| ubuntu |"))
    assert.ok(
      md.includes(
        "![ubuntu en](./apps/myapp/__checks__/HomePage/__screenshots__/HomePage.screenshot.spec.ts/home-page-Desktop-Chrome---en.png)"
      )
    )
    assert.ok(md.includes("<summary>☑️ should match visual snapshot</summary>"))
  })

  test("makes spec paths relative to outputDir when outputDir != root", () => {
    const outputDir = join(tmpDir, "apps/myapp")
    mkdirSync(outputDir, { recursive: true })

    const domains: AppDomains = new Map([
      [
        "",
        new Map([
          [
            "unknown",
            new Map([
              [
                "page",
                [
                  {
                    describes: [],
                    pageName: "page",
                    specPath:
                      "apps/myapp/web/e2e/__checks__/page.guest.spec.ts",
                    specType: "default",
                    steps: [],
                    title: "test one",
                  },
                  {
                    describes: [],
                    pageName: "page",
                    specPath:
                      "packages/routes/auth/web/e2e/__checks__/login.guest.spec.ts",
                    specType: "default",
                    steps: [],
                    title: "test two",
                  },
                ],
              ],
            ]),
          ],
        ]),
      ],
    ])

    const md = renderApp("myapp", domains, { outputDir })
    assert.ok(
      md.includes(
        "📄 [`apps/myapp/web/e2e/__checks__/page.guest.spec.ts`](./web/e2e/__checks__/page.guest.spec.ts)"
      )
    )
    assert.ok(
      md.includes(
        "📄 [`packages/routes/auth/web/e2e/__checks__/login.guest.spec.ts`](../../packages/routes/auth/web/e2e/__checks__/login.guest.spec.ts)"
      )
    )
  })

  test("multi-page folder emits balanced details tags", () => {
    const domains: AppDomains = new Map([
      [
        "",
        new Map([
          [
            "SomeFolder",
            new Map([
              [
                "PageA",
                [
                  {
                    describes: [],
                    pageName: "PageA",
                    specPath:
                      "apps/myapp/__checks__/SomeFolder/PageA.guest.spec.ts",
                    specType: "default",
                    steps: [],
                    title: "test a",
                  },
                ],
              ],
              [
                "PageB",
                [
                  {
                    describes: [],
                    pageName: "PageB",
                    specPath:
                      "apps/myapp/__checks__/SomeFolder/PageB.guest.spec.ts",
                    specType: "default",
                    steps: [],
                    title: "test b",
                  },
                ],
              ],
            ]),
          ],
        ]),
      ],
    ])

    const md = renderApp("myapp", domains)
    const opens = (md.match(/<details>/g) ?? []).length
    const closes = (md.match(/<\/details>/g) ?? []).length
    assert.equal(opens, closes)
  })

  test("renders screenshot gallery for flat spec (screenshots sibling to __checks__)", () => {
    const checksDir = join(tmpDir, "apps/myapp/__checks__")
    mkdirSync(checksDir, { recursive: true })
    writeFileSync(
      join(checksDir, "settings-page.screenshot.spec.ts"),
      `test('should match visual snapshot', async ({ page }) => {
  await expect(page).toHaveScreenshot("settings-page.png")
})`,
      "utf-8"
    )

    const domains: AppDomains = new Map([
      [
        "",
        new Map([
          [
            "unknown",
            new Map([
              [
                "settings-page",
                [
                  {
                    describes: ["PageSettings"],
                    pageName: "settings-page",
                    specPath:
                      "apps/myapp/__checks__/settings-page.screenshot.spec.ts",
                    specType: "screenshot",
                    steps: [],
                    title: "should match visual snapshot",
                  },
                ],
              ],
            ]),
          ],
        ]),
      ],
    ])

    const md = renderApp("myapp", domains, {
      config: {
        plugins: [localesPlugin(["ru"])],
        specTypes: sampleSpecTypes,
      },
    })
    assert.ok(md.includes("<summary>📸 screenshots</summary>"))
    assert.ok(!md.includes("<summary>📸 screenshots ("))
    assert.ok(md.includes("**settings-page**"))
    assert.ok(md.includes("| macOS |"))
    assert.ok(
      md.includes(
        "![macOS ru](./apps/myapp/__screenshots__/settings-page.screenshot.spec.ts/settings-page-Desktop-Safari---ru.png)"
      )
    )
  })

  test("renders screenshot table grouped by OS with en/ru columns", () => {
    const specDir = join(tmpDir, "apps/myapp/__checks__/HomePage")
    mkdirSync(specDir, { recursive: true })
    writeFileSync(
      join(specDir, "HomePage.screenshot.spec.ts"),
      `test('should match visual snapshot', async ({ page }) => {
  await expect(page).toHaveScreenshot("basename.png")
})`,
      "utf-8"
    )

    const domains: AppDomains = new Map([
      [
        "",
        new Map([
          [
            "HomePage",
            new Map([
              [
                "HomePage",
                [
                  {
                    describes: ["HomePage"],
                    pageName: "HomePage",
                    specPath:
                      "apps/myapp/__checks__/HomePage/HomePage.screenshot.spec.ts",
                    specType: "screenshot",
                    steps: [],
                    title: "should match visual snapshot",
                  },
                ],
              ],
            ]),
          ],
        ]),
      ],
    ])

    const md = renderApp("myapp", domains, {
      config: {
        plugins: [localesPlugin(["en", "ru"])],
        specTypes: sampleSpecTypes,
      },
    })
    assert.ok(md.includes("<summary>📸 screenshots</summary>"))
    assert.ok(md.includes("**basename**"))
    assert.ok(md.includes("| | en | ru |"))
    assert.ok(md.includes("| ubuntu |"))
    assert.ok(
      md.includes(
        "![ubuntu en](./apps/myapp/__checks__/HomePage/__screenshots__/HomePage.screenshot.spec.ts/basename-Desktop-Chrome---en.png)"
      )
    )
    assert.ok(
      md.includes(
        "![ubuntu ru](./apps/myapp/__checks__/HomePage/__screenshots__/HomePage.screenshot.spec.ts/basename-Desktop-Chrome---ru.png)"
      )
    )
    assert.ok(md.includes("| macOS |"))
    assert.ok(
      md.includes(
        "![macOS en](./apps/myapp/__checks__/HomePage/__screenshots__/HomePage.screenshot.spec.ts/basename-Desktop-Safari---en.png)"
      )
    )
    assert.ok(
      md.includes(
        "![macOS ru](./apps/myapp/__checks__/HomePage/__screenshots__/HomePage.screenshot.spec.ts/basename-Desktop-Safari---ru.png)"
      )
    )
  })

  test("injects app name into screenshot filename for multi-app specs", () => {
    const e2eDir = join(
      tmpDir,
      "packages/routes/notfound/web/packages/pages/notfound-page/e2e"
    )
    const checksDir = join(e2eDir, "__checks__")
    mkdirSync(checksDir, { recursive: true })
    writeFileSync(
      join(checksDir, "notfound-page.screenshot.spec.ts"),
      `test('should match visual snapshot', async ({ page }) => {
  await expect(page).toHaveScreenshot("notfound-page.png")
})`,
      "utf-8"
    )

    const specPath =
      "packages/routes/notfound/web/packages/pages/notfound-page/e2e/__checks__/notfound-page.screenshot.spec.ts"

    const makeDomains = (): AppDomains =>
      new Map([
        [
          "",
          new Map([
            [
              "pages",
              new Map([
                [
                  "notfound-page",
                  [
                    {
                      describes: ["notfound-page"],
                      pageName: "notfound-page",
                      sharedAcrossApps: true,
                      specPath,
                      specType: "screenshot",
                      steps: [],
                      title: "should match visual snapshot",
                    },
                  ],
                ],
              ]),
            ],
          ]),
        ],
      ])

    const mdA = renderApp("APPA", makeDomains(), {
      config: {
        plugins: [localesPlugin(["en"])],
        specTypes: sampleSpecTypes,
      },
    })
    assert.ok(mdA.includes("**notfound-page-APPA**"))
    assert.ok(
      mdA.includes(
        "notfound-page.screenshot.spec.ts/notfound-page-APPA-Desktop-Chrome---en.png"
      )
    )

    const mdB = renderApp("APPB", makeDomains(), {
      config: {
        plugins: [localesPlugin(["en"])],
        specTypes: sampleSpecTypes,
      },
    })
    assert.ok(mdB.includes("**notfound-page-APPB**"))
    assert.ok(
      mdB.includes(
        "notfound-page.screenshot.spec.ts/notfound-page-APPB-Desktop-Chrome---en.png"
      )
    )
  })

  test("single-page folder does not emit extra closing tags", () => {
    const domains: AppDomains = new Map([
      [
        "",
        new Map([
          [
            "SinglePageFolder",
            new Map([
              [
                "MyPage",
                [
                  {
                    describes: [],
                    pageName: "MyPage",
                    specPath:
                      "apps/myapp/__checks__/MyPage/MyPage.guest.spec.ts",
                    specType: "default",
                    steps: [],
                    title: "should render",
                  },
                ],
              ],
            ]),
          ],
        ]),
      ],
    ])

    const md = renderApp("myapp", domains)
    const opens = (md.match(/<details>/g) ?? []).length
    const closes = (md.match(/<\/details>/g) ?? []).length
    assert.equal(opens, closes)
  })

  test("does not wrap count badges in bold", () => {
    const domains: AppDomains = new Map([
      [
        "",
        new Map([
          [
            "unknown",
            new Map([
              [
                "page",
                [
                  {
                    describes: ["page", "section"],
                    pageName: "page",
                    specPath: "apps/myapp/__checks__/page.spec.ts",
                    specType: "default",
                    steps: [],
                    title: "should collapse",
                  },
                ],
              ],
            ]),
          ],
        ]),
      ],
    ])

    const md = renderApp("myapp", domains)
    assert.doesNotMatch(md, /\*\*\(\d+ tests\)\*\*/)
  })

  test("renders steps with blockquote prefix", () => {
    const domains: AppDomains = new Map([
      [
        "",
        new Map([
          [
            "unknown",
            new Map([
              [
                "page",
                [
                  {
                    describes: [],
                    pageName: "page",
                    specPath: "apps/myapp/__checks__/page.spec.ts",
                    specType: "default",
                    steps: [
                      "Navigate to homepage",
                      "Click the button",
                      "Verify result",
                    ],
                    title: "should complete flow",
                  },
                ],
              ],
            ]),
          ],
        ]),
      ],
    ])

    const md = renderApp("myapp", domains)
    assert.ok(md.includes("<summary>☑️ should complete flow</summary>"))
    assert.ok(md.includes("<blockquote>"))
    assert.ok(md.includes("1. Navigate to homepage"))
    assert.ok(md.includes("2. Click the button"))
    assert.ok(md.includes("3. Verify result"))
  })

  test("renders file link for each spec type section", () => {
    const domains: AppDomains = new Map([
      [
        "",
        new Map([
          [
            "unknown",
            new Map([
              [
                "page",
                [
                  {
                    describes: [],
                    pageName: "page",
                    specPath: "apps/myapp/__checks__/page.guest.spec.ts",
                    specType: "default",
                    steps: [],
                    title: "test one",
                  },
                  {
                    describes: [],
                    pageName: "page",
                    specPath: "apps/myapp/__checks__/page.auth.spec.ts",
                    specType: "default",
                    steps: [],
                    title: "test two",
                  },
                ],
              ],
            ]),
          ],
        ]),
      ],
    ])

    const md = renderApp("myapp", domains)
    assert.ok(
      md.includes(
        "📄 [`apps/myapp/__checks__/page.guest.spec.ts`](./apps/myapp/__checks__/page.guest.spec.ts)"
      )
    )
    assert.ok(
      md.includes(
        "📄 [`apps/myapp/__checks__/page.auth.spec.ts`](./apps/myapp/__checks__/page.auth.spec.ts)"
      )
    )
  })

  test("renders multiple file links when spec type has tests from different files", () => {
    const domains: AppDomains = new Map([
      [
        "",
        new Map([
          [
            "unknown",
            new Map([
              [
                "page",
                [
                  {
                    describes: [],
                    pageName: "page",
                    specPath: "apps/myapp/__checks__/page/a.guest.spec.ts",
                    specType: "default",
                    steps: [],
                    title: "test a",
                  },
                  {
                    describes: [],
                    pageName: "page",
                    specPath: "apps/myapp/__checks__/page/b.guest.spec.ts",
                    specType: "default",
                    steps: [],
                    title: "test b",
                  },
                ],
              ],
            ]),
          ],
        ]),
      ],
    ])

    const md = renderApp("myapp", domains)
    assert.ok(
      md.includes(
        "📄 [`apps/myapp/__checks__/page/a.guest.spec.ts`](./apps/myapp/__checks__/page/a.guest.spec.ts)"
      )
    )
    assert.ok(
      md.includes(
        "📄 [`apps/myapp/__checks__/page/b.guest.spec.ts`](./apps/myapp/__checks__/page/b.guest.spec.ts)"
      )
    )
  })

  test("deduplicates file links when multiple tests share the same spec file", () => {
    const domains: AppDomains = new Map([
      [
        "",
        new Map([
          [
            "unknown",
            new Map([
              [
                "page",
                [
                  {
                    describes: [],
                    pageName: "page",
                    specPath: "apps/myapp/__checks__/page.guest.spec.ts",
                    specType: "default",
                    steps: [],
                    title: "test one",
                  },
                  {
                    describes: [],
                    pageName: "page",
                    specPath: "apps/myapp/__checks__/page.guest.spec.ts",
                    specType: "default",
                    steps: [],
                    title: "test two",
                  },
                ],
              ],
            ]),
          ],
        ]),
      ],
    ])

    const md = renderApp("myapp", domains)
    const linkCount = (
      md.match(/📄 \[`apps\/myapp\/__checks__\/page\.guest\.spec\.ts`\]/g) ?? []
    ).length
    assert.equal(linkCount, 1)
  })
})

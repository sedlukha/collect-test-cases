import { readFileSync } from "node:fs"
import { extname } from "node:path"

import ts from "typescript"

export interface TestCase {
  describes: string[]
  // Set on a synthetic placeholder for a fallback file that text-parsing found
  // NO tests in (e.g. all its tests come from a shared helper). It is not a real
  // test — it is excluded from every count and rendered only as a warning, so
  // the file is not silently dropped or shown as an unexplained "0 tests".
  emptyFallback?: boolean
  // True when this case was text-parsed as a fallback while a discovery adapter
  // was active (the runner did not report the file). The renderer marks it so a
  // reader can see the case did not come from the runner. `undefined` otherwise.
  fallback?: boolean
  // Captured when the call carried a modifier (`test.skip('foo', ...)` →
  // `'skip'`). `undefined` for plain `test()`/`it()`.
  modifier?: "fail" | "fixme" | "only" | "skip" | "slow" | "todo"
  pageName: string
  // True on every copy after the first, when `resolvePageName` returned several
  // page names for one spec file. The copy is rendered inside its page group,
  // but the header total skips it. So one test is counted one time.
  pageRepeat?: boolean
  // True when the same spec file is included in more than one app's output.
  // Used by the screenshot gallery to inject the app name into image
  // filenames so per-app snapshots don't collide. Defaults to `false` when
  // omitted — the grouper sets this from the configured `resolveApp`.
  sharedAcrossApps?: boolean
  specPath: string
  specType: string
  steps: string[]
  title: string
}

const TEST_FNS = new Set(["it", "test"])
// Modifiers that map to a `modifier` value on the emitted TestCase.
const TEST_MODIFIERS = new Set([
  "fail",
  "fixme",
  "only",
  "skip",
  "slow",
  "todo",
])
// Recognised as a plain test but WITHOUT a modifier icon — they change how the
// runner schedules the test, not whether it runs. `it.concurrent('x', fn)` and
// `it.sequential('x', fn)` read as ordinary tests in the document.
const PLAIN_TEST_METHODS = new Set(["concurrent", "sequential"])
// Methods that RETURN a test/describe function and are then called with the
// title: `it.each(table)('…')`, `it.for(table)('…')`, `it.skipIf(x)('…')`,
// `it.runIf(x)('…')`, `test.extend({})('…')`. The callee of the outer call is
// itself a call (or tagged template), so these are classified separately from
// the plain `it.skip('…')` property-access forms.
const GENERATOR_METHODS = new Set([
  "each",
  "extend",
  "for",
  "runIf",
  "skipIf",
])
const DESCRIBE_MODIFIERS = new Set(["fixme", "only", "skip"])

type CallKind =
  | null
  | { kind: "describe"; modifier?: string }
  | { kind: "step" }
  | { kind: "test"; modifier?: string }

// Walks a property-access chain back to an identifier root and returns
// every segment in order (`test.describe.skip` → `["test","describe","skip"]`).
// Returns `null` if the chain doesn't bottom out at an identifier (e.g.
// `foo().bar` or `arr[0].test`).
const collectAccess = (expr: ts.Expression): string[] | null => {
  const segments: string[] = []
  let current: ts.Expression = expr

  while (ts.isPropertyAccessExpression(current)) {
    segments.unshift(current.name.text)
    current = current.expression
  }

  if (ts.isIdentifier(current)) {
    segments.unshift(current.text)

    return segments
  }

  return null
}

// Classifies a chain like `it.each(table)` / `describe.each(t)` / `it.skip.each(t)`
// where the callee of the OUTER test call is itself a call. `inner` is the
// property-access chain reached through the call/tagged-template wrapper (the
// `it.each` in `it.each(table)('…')`). Returns the test/describe classification
// for the outer call, or `null` if the chain isn't a recognised generator form.
const classifyGenerator = (inner: ts.Expression): CallKind => {
  if (!ts.isPropertyAccessExpression(inner)) return null

  const segments = collectAccess(inner)
  if (segments === null) return null

  const [root, ...rest] = segments
  const gen = rest[rest.length - 1]

  if (root === undefined || gen === undefined || !GENERATOR_METHODS.has(gen)) {
    return null
  }

  // Segments sitting between the root and the trailing generator method, e.g.
  // `it.skip.each` → `['skip']`, `test.describe.each` → `['describe']`.
  const middle = rest.slice(0, -1)

  if (TEST_FNS.has(root)) {
    // test.describe.each(table)('…') — a parametrised describe block.
    if (middle.length === 1 && middle[0] === "describe") {
      return { kind: "describe" }
    }

    // it.each / test.for / it.extend / it.skipIf / it.runIf, optionally with a
    // single modifier in between (`it.skip.each(table)('…')`).
    if (middle.length === 0) return { kind: "test" }

    const m = middle[0]
    if (middle.length === 1 && m !== undefined && TEST_MODIFIERS.has(m)) {
      return { kind: "test", modifier: m }
    }

    return null
  }

  if (root === "describe" && middle.length === 0) {
    return { kind: "describe" }
  }

  return null
}

// Classifies a call expression's callee against the set of frameworks this
// package understands. Unrecognised callees (helpers, hooks, anything else)
// return `null` and the walker simply recurses into their bodies.
const classifyCall = (expr: ts.Expression): CallKind => {
  // Generator forms: the callee is itself a call (`it.each(table)('…')`) or a
  // tagged template (``it.each`…`('…')``). Look through that wrapper.
  if (ts.isCallExpression(expr)) return classifyGenerator(expr.expression)
  if (ts.isTaggedTemplateExpression(expr)) return classifyGenerator(expr.tag)

  if (ts.isIdentifier(expr)) {
    if (TEST_FNS.has(expr.text)) return { kind: "test" }
    if (expr.text === "describe") return { kind: "describe" }

    return null
  }

  if (!ts.isPropertyAccessExpression(expr)) return null

  const segments = collectAccess(expr)
  if (segments === null) return null

  const [root, ...rest] = segments
  if (root === undefined) return null

  if (TEST_FNS.has(root)) {
    if (rest.length === 1) {
      const m = rest[0]

      if (m === undefined) return null
      if (m === "describe") return { kind: "describe" }
      if (m === "step") return { kind: "step" }
      if (TEST_MODIFIERS.has(m)) return { kind: "test", modifier: m }
      // it.concurrent / it.sequential — a real test, rendered without a
      // modifier icon (the runner only changes scheduling).
      if (PLAIN_TEST_METHODS.has(m)) return { kind: "test" }

      // test.beforeEach / test.afterEach / test.use / test.extend / …
      // — not a test, not a step. The walker will recurse into the
      // callback body the same way it would for any other call.
      return null
    }

    if (rest.length === 2 && rest[0] === "describe") {
      const m = rest[1]

      if (m !== undefined && DESCRIBE_MODIFIERS.has(m)) {
        return { kind: "describe", modifier: m }
      }
    }

    return null
  }

  if (root === "describe") {
    const m = rest[0]

    if (rest.length === 1 && m !== undefined && DESCRIBE_MODIFIERS.has(m)) {
      return { kind: "describe", modifier: m }
    }
  }

  return null
}

// Pulls a human-readable label out of the first argument of a test /
// describe / step call.
//
// - String literal & no-substitution template literal: the literal text.
// - Template literal with `${...}` spans: literal segments verbatim,
//   substitution expressions inlined as `${source-text}` (preserves the
//   spirit of the title without evaluating the expression).
// - Anything else (identifier, function call, etc.): the source text of
//   the expression, trimmed. The renderer is free to display it as-is.
const extractTitle = (
  arg: ts.Expression | undefined,
  source: ts.SourceFile
): string => {
  if (arg === undefined) return ""

  if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) {
    return arg.text
  }

  if (ts.isTemplateExpression(arg)) {
    let result = arg.head.text

    for (const span of arg.templateSpans) {
      const exprSrc = span.expression.getText(source).trim()
      result += `\${${exprSrc}}${span.literal.text}`
    }

    return result
  }

  return arg.getText(source).trim()
}

const pickScriptKind = (path: string): ts.ScriptKind => {
  const ext = extname(path).toLowerCase()

  if (ext === ".tsx") return ts.ScriptKind.TSX
  if (ext === ".jsx") return ts.ScriptKind.JSX
  if (ext === ".js" || ext === ".mjs" || ext === ".cjs") return ts.ScriptKind.JS

  return ts.ScriptKind.TS
}

export const parseSpecFile = (absolutePath: string): TestCase[] => {
  const content = readFileSync(absolutePath, "utf-8")
  const source = ts.createSourceFile(
    absolutePath,
    content,
    ts.ScriptTarget.ESNext,
    false,
    pickScriptKind(absolutePath)
  )

  const results: TestCase[] = []
  const describeStack: string[] = []

  const visit = (node: ts.Node, currentTest: TestCase | null): void => {
    if (ts.isCallExpression(node)) {
      const kind = classifyCall(node.expression)

      if (kind?.kind === "describe") {
        const name = extractTitle(node.arguments[0], source)
        describeStack.push(name)
        ts.forEachChild(node, (child) => visit(child, currentTest))
        describeStack.pop()

        return
      }

      if (kind?.kind === "test") {
        const title = extractTitle(node.arguments[0], source)
        const testCase: TestCase = {
          describes: [...describeStack],
          pageName: "",
          specPath: absolutePath,
          specType: "unknown",
          steps: [],
          title,
        }

        if (kind.modifier) {
          testCase.modifier = kind.modifier as TestCase["modifier"]
        }

        results.push(testCase)
        ts.forEachChild(node, (child) => visit(child, testCase))

        return
      }

      if (kind?.kind === "step" && currentTest) {
        currentTest.steps.push(extractTitle(node.arguments[0], source))
        // fall through — recurse so nested test.step() calls are captured
      }
    }

    ts.forEachChild(node, (child) => visit(child, currentTest))
  }

  visit(source, null)

  return results
}

import { readFileSync } from "node:fs"
import { extname } from "node:path"

import ts from "typescript"

export interface TestCase {
  describes: string[]
  // Captured when the call carried a modifier (`test.skip('foo', ...)` →
  // `'skip'`). `undefined` for plain `test()`/`it()`.
  modifier?: "fail" | "fixme" | "only" | "skip" | "slow"
  pageName: string
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
const TEST_MODIFIERS = new Set(["fail", "fixme", "only", "skip", "slow"])
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

// Classifies a call expression's callee against the set of frameworks this
// package understands. Unrecognised callees (helpers, hooks, anything else)
// return `null` and the walker simply recurses into their bodies.
const classifyCall = (expr: ts.Expression): CallKind => {
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

import { readFileSync } from "node:fs"

export interface TestCase {
  describes: string[]
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

// `test.` prefix is optional (Jest/Mocha/Cypress use bare `describe()`);
// `.only` / `.skip` / `.fixme` modifiers are accepted on either form.
const DESCRIBE_RE =
  /\b(?:test\.)?describe(?:\.(?:skip|only|fixme))?\s*\(\s*(['"`])(.*?)\1/
// `test` / `it` may carry one of the whitelisted modifiers. `test.describe`
// and `test.step` are intentionally excluded here — they're matched by
// their own regex above / below.
const TEST_RE =
  /(?:^|[\s(,;])(?:test|it)(?:\.(?:skip|only|fixme|fail|slow))?\s*\(\s*(['"`])(.*?)\1/
const STEP_RE = /\btest\.step\s*\(\s*(['"`])(.*?)\1/

const isTestCall = (line: string, match: RegExpMatchArray): boolean => {
  const idx = match.index ?? 0
  const keyword = match[0].trimStart().startsWith("test") ? "test" : "it"
  const before = line.slice(0, idx + match[0].indexOf(keyword))
  const trimmedBefore = before.trimEnd()

  return !trimmedBefore.endsWith(".")
}

const countBraces = (line: string): { closes: number; opens: number } => {
  let opens = 0
  let closes = 0

  for (const ch of line) {
    if (ch === "{") {
      opens += 1
    } else if (ch === "}") {
      closes += 1
    }
  }

  return {
    closes,
    opens,
  }
}

export const parseSpecFile = (absolutePath: string): TestCase[] => {
  const content = readFileSync(absolutePath, "utf-8")
  const normalized = content
    .replace(
      /\b((?:test\.)?describe(?:\.(?:skip|only|fixme))?)\s*\(\s*\n\s*/g,
      "$1("
    )
    .replace(
      /\b((?:test|it)(?:\.(?:skip|only|fixme|fail|slow))?)\s*\(\s*\n\s*/g,
      "$1("
    )
  const lines = normalized.split("\n")
  const results: TestCase[] = []

  const describeStack: { depth: number; name: string }[] = []
  let braceDepth = 0

  let currentTestBodyDepth: number | null = null
  let currentSteps: string[] = []

  for (const line of lines) {
    if (currentTestBodyDepth !== null) {
      const stepMatch = STEP_RE.exec(line)

      if (stepMatch?.[2]) {
        currentSteps.push(stepMatch[2].trim())
      }
    }

    const describeMatch = DESCRIBE_RE.exec(line)

    if (describeMatch) {
      const name = describeMatch[2] ?? ""
      const { closes, opens } = countBraces(line)
      const depthBefore = braceDepth
      braceDepth += opens - closes
      describeStack.push({
        depth: depthBefore + opens,
        name,
      })
    } else {
      const testMatch = TEST_RE.exec(line)

      const isNewTest = testMatch !== null && isTestCall(line, testMatch)

      if (isNewTest) {
        const title = testMatch[2] ?? ""
        currentSteps = []
        results.push({
          describes: describeStack.map((d) => d.name),
          pageName: "",
          specPath: absolutePath,
          specType: "unknown",
          steps: currentSteps,
          title,
        })
      }

      const { closes, opens } = countBraces(line)
      braceDepth += opens - closes

      if (isNewTest) {
        currentTestBodyDepth = braceDepth
      } else if (
        currentTestBodyDepth !== null &&
        braceDepth < currentTestBodyDepth
      ) {
        currentTestBodyDepth = null
      }

      while (
        describeStack.length > 0 &&
        braceDepth < (describeStack.at(-1)?.depth ?? 0)
      ) {
        describeStack.pop()
      }
    }
  }

  return results
}

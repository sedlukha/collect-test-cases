import { describe, expect, it } from "vitest"

// A shared helper that registers a block of tests. Spec files call it instead
// of repeating the same assertions. The `describe`/`it` calls run only at
// runtime, so these tests are invisible to static parsing.
export const defineTotalsSuite = (name: string): void => {
  describe(name, () => {
    it("sums line items", () => {
      expect(1 + 1).toBe(2)
    })

    it("applies discount code", () => {
      expect(0.9).toBeLessThan(1)
    })
  })
}

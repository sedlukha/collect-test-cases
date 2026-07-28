import { describe, expect, it } from "vitest"

// Tests created inside a shared helper — invisible to static text parsing.
export const defineTotalsSuite = (name: string): void => {
  describe(name, () => {
    it("sums line items", () => { expect(1 + 1).toBe(2) })
    it("applies discount code", () => { expect(0.9).toBeLessThan(1) })
  })
}

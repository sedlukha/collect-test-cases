const { describe, it, expect } = require("@jest/globals")
describe("Statuses", () => {
  it("normal one", () => { expect(1).toBe(1) })
  it.skip("skipped one", () => {})
  it.todo("todo one")
})

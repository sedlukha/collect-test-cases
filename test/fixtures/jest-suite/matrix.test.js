const { describe, it, expect } = require("@jest/globals")
describe.each([["a"], ["b"]])("row %s", (v) => {
  it("has a value", () => { expect(v).toBeTruthy() })
})

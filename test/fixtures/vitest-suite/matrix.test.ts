import { describe, expect, it } from "vitest"

describe.each([["a"], ["b"]])("row %s", (v) => {
  it("has a value", () => { expect(v).toBeTruthy() })
})

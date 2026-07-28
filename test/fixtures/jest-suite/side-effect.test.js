const { it, expect } = require("@jest/globals")
const fs = require("node:fs")
const path = require("node:path")

it("writes a marker when the body executes", () => {
  fs.writeFileSync(path.join(__dirname, "RAN.marker"), "ran")
  expect(true).toBe(true)
})

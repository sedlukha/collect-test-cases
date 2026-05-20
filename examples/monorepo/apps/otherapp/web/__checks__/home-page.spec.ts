import { expect, test } from "@playwright/test"

// This file belongs to `otherapp` — collect-test-cases must NOT include it
// in `myapp`'s generated README.
test("renders otherapp's marketing headline", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
})

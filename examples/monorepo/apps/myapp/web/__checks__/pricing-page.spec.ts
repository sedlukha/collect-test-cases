import { expect, test } from "@playwright/test"

test("lists three pricing tiers", async ({ page }) => {
  await page.goto("/pricing")
  await expect(page.getByRole("article")).toHaveCount(3)
})

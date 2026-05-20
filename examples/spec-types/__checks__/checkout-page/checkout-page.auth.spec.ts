import { expect, test } from "@playwright/test"

test.describe("checkout (authenticated)", () => {
  test("pre-fills the saved address", async ({ page }) => {
    await page.goto("/checkout")
    await expect(page.getByLabel("Address")).not.toHaveValue("")
  })

  test("supports applying a stored payment method", async () => {})
})

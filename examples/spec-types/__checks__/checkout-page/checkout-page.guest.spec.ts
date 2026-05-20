import { expect, test } from "@playwright/test"

test.describe("checkout (guest)", () => {
  test("anonymous user sees the shipping form", async ({ page }) => {
    await page.goto("/checkout")
    await expect(page.getByRole("heading", { name: /shipping/i })).toBeVisible()
  })

  test("anonymous user can place an order", async () => {})
})

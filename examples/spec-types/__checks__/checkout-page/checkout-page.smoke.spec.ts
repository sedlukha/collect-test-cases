import { expect, test } from "@playwright/test"

test("the /checkout page returns 200 OK", async ({ page }) => {
  const response = await page.goto("/checkout")
  expect(response?.status()).toBe(200)
})

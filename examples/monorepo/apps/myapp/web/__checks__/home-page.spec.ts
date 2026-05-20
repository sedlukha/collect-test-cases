import { expect, test } from "@playwright/test"

test.describe("home page", () => {
  test("renders the marketing headline", async ({ page }) => {
    await page.goto("/")
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
  })

  test("returns 200 OK", async ({ page }) => {
    const response = await page.goto("/")
    expect(response?.status()).toBe(200)
  })
})

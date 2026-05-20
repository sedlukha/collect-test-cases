import { expect, test } from "@playwright/test"

test("returns 200 OK for the home page", async ({ page }) => {
  const response = await page.goto("/")
  expect(response?.status()).toBe(200)
})

test("renders the marketing headline", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
})

test.skip("redirects logged-in users to the dashboard", async () => {
  // pending: requires session fixture
})

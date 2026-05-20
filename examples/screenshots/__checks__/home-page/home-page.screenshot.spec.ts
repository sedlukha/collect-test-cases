import { expect, test } from "@playwright/test"

test.describe("home page (visual)", () => {
  test("matches the hero section snapshot", async ({ page }) => {
    await page.goto("/")
    await expect(page).toHaveScreenshot("hero.png")
  })
})

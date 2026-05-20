import { expect, test } from "@playwright/test"

test.describe("auth › login", () => {
  test("renders the login form", async ({ page }) => {
    await page.goto("/login")
    await expect(page.getByLabel("Email")).toBeVisible()
  })

  test("rejects an empty submission", async ({ page }) => {
    await page.goto("/login")
    await page.getByRole("button", { name: "Sign in" }).click()
    await expect(page.getByRole("alert")).toBeVisible()
  })
})

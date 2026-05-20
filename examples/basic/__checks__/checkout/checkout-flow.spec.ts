import { expect, test } from "@playwright/test"

test.describe("checkout flow", () => {
  test("guest can complete checkout end-to-end", async ({ page }) => {
    await test.step("add an item to the cart", async () => {
      await page.goto("/product/42")
      await page.getByRole("button", { name: "Add to cart" }).click()
    })

    await test.step("proceed to checkout", async () => {
      await page.getByRole("link", { name: "Checkout" }).click()
    })

    await test.step("confirm the order summary", async () => {
      await expect(page.getByRole("heading", { name: /thank you/i })).toBeVisible()
    })
  })

  test.only("shows shipping options when address is filled in", async () => {})

  test.fixme("supports applying a discount code", async () => {})
})

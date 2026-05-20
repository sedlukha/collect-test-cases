import { expect, test } from "@playwright/test"

test.describe(`${t("page.title")} page`, () => {
  test(`renders the t('button.submit') button`, async ({ page }) => {
    await page.goto("/login")
    await expect(
      page.getByRole("button", { name: t("button.submit") })
    ).toBeVisible()
  })

  test(`shows t('validation.maxLength', { fieldName: t('field.email'), max: '254' }) when input is too long`, async ({
    page,
  }) => {
    await page.goto("/login")
    await page.getByLabel(t("field.email")).fill("x".repeat(255))
    await page.getByRole("button", { name: t("button.submit") }).click()
  })

  test(`shows t('validation.required', { fieldName: t('field.password') })`, async ({
    page,
  }) => {
    await page.goto("/login")
    await page.getByRole("button", { name: t("button.submit") }).click()
  })
})

declare function t(key: string, params?: Record<string, string>): string

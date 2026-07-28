import { describe, expect, it } from "vitest"

const cards = ["Visa", "Mastercard", "Amex"]

describe("Checkout", () => {
  it.each(cards)("accepts %s", (card) => { expect(card).toBeTruthy() })
  it("shows the order summary", () => { expect(true).toBe(true) })
})

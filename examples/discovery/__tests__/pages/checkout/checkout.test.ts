import { describe, expect, it } from "vitest"

const cards = ["Visa", "Mastercard", "Amex"]

describe("Checkout", () => {
  // Parametrised with `it.each`. A text parser sees ONE entry here (the
  // `accepts %s` template); the runner expands it into one test per card.
  it.each(cards)("accepts %s", (card) => {
    expect(card).toBeTruthy()
  })
})

#!/usr/bin/env node
// Stand-in for `vitest list --json`, so this example runs with no Vitest
// install. In a real project you would drop the `command`/`commandArgs`
// override and let `vitestDiscovery()` call your actual `vitest`.
//
// This prints exactly what `vitest list --json` returns: one entry per test,
// with the fully-qualified name joined by " > ". Note it includes every
// `it.each` row AND the two helper-created tests — the things text parsing
// cannot see.
const list = [
  {
    file: "__tests__/pages/checkout/checkout.test.ts",
    name: "Checkout > accepts Visa",
  },
  {
    file: "__tests__/pages/checkout/checkout.test.ts",
    name: "Checkout > accepts Mastercard",
  },
  {
    file: "__tests__/pages/checkout/checkout.test.ts",
    name: "Checkout > accepts Amex",
  },
  {
    file: "__tests__/pages/cart/cart.test.ts",
    name: "Cart totals > sums line items",
  },
  {
    file: "__tests__/pages/cart/cart.test.ts",
    name: "Cart totals > applies discount code",
  },
]

console.log(JSON.stringify(list))

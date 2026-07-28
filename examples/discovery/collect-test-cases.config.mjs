import { vitestDiscovery } from "collect-test-cases/plugins/discovery"

/** @type {import('collect-test-cases').CollectTestCasesConfig} */
const config = {
  appName: "discovery",
  outputPath: "./OUTPUT.md",
  include: ["__tests__/**/*.test.ts"],
  specsDir: "__tests__",

  // The default page name is the single segment after `specsDir`, so
  // `__tests__/pages/checkout/...` and `__tests__/pages/cart/...` would BOTH
  // collapse into one "pages" group. Key on the full sub-path instead.
  resolvePageName: (absPath, root) => {
    const parts = absPath.slice(root.length + 1).split("/")

    return parts.slice(1, -1).join("/") || null
  },

  specTypes: { other: { label: "Tests", order: 100 } },

  // Ask the runner for its real test list. In a real project this is just
  // `vitestDiscovery()`; here we point it at a tiny fake runner so the example
  // needs no Vitest install.
  plugins: [
    vitestDiscovery({ command: "node", commandArgs: ["./fake-runner.mjs"] }),
  ],
}

export default config

/** @type {import('collect-test-cases').CollectTestCasesConfig} */
const config = {
  appName: "screenshots",
  outputPath: "./OUTPUT.md",
  specTypes: {
    screenshot: {
      gallery: true,
      label: "📸 Visual",
      order: 0,
      pattern: ".screenshot.",
    },
    other: {
      label: "Tests",
      order: 100,
    },
  },
}

export default config

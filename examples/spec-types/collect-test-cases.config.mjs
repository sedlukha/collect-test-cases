/** @type {import('collect-test-cases').CollectTestCasesConfig} */
const config = {
  appName: "spec-types",
  outputPath: "./OUTPUT.md",
  specTypes: {
    guest: {
      label: "👤 Guest",
      order: 0,
      pattern: ".guest.",
    },
    auth: {
      label: "🔐 Authenticated",
      order: 1,
      pattern: ".auth.",
    },
    smoke: {
      label: "💨 Smoke",
      order: 2,
      pattern: /\.smoke\./,
    },
    other: {
      label: "Other",
      order: 100,
    },
  },
}

export default config

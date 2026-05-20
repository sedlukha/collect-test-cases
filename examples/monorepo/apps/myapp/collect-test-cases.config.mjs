/** @type {import('collect-test-cases').CollectTestCasesConfig} */
const config = {
  appName: "myapp",
  // Walk up from apps/myapp/ to examples/monorepo/ so layout.appsDir
  // and layout.routesDir resolve naturally.
  rootDir: "../..",
  // Two scan roots: the apps tree (myapp + otherapp) and the shared
  // routes tree.
  scanDirs: ["../..", "../../packages/routes"],
  outputPath: "../../OUTPUT.md",
  layout: {
    appsDir: "apps",
    routesDir: "packages/routes",
    sharedSpecs: {},
  },
}

export default config

import { i18nPlugin } from "collect-test-cases/plugins/i18n"

/** @type {import('collect-test-cases').CollectTestCasesConfig} */
const config = {
  appName: "i18n",
  outputPath: "./OUTPUT.md",
  plugins: [
    i18nPlugin({
      locales: ["en", "ru"],
      messages: "messages/*.json",
    }),
  ],
}

export default config

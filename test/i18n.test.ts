import assert from "node:assert/strict"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, test } from "node:test"

import {
  i18nPlugin,
  loadMessages,
  type MessagesMap,
  resolveTranslationKeys,
} from "../src/plugins/i18n/index.js"

let tmpDir: string

beforeEach(() => {
  tmpDir = join(
    tmpdir(),
    `collect-test-cases-i18n-${Date.now()}-${Math.random()}`
  )
  mkdirSync(tmpDir, { recursive: true })
})

afterEach(() => {
  rmSync(tmpDir, {
    force: true,
    recursive: true,
  })
})

describe("resolveTranslationKeys", () => {
  test("resolves t() — single locale shows plain value", () => {
    const messages: MessagesMap = new Map([["en", { "page.title": "Welcome" }]])
    const out = resolveTranslationKeys(
      "page title is t('page.title')",
      messages,
      ["en"]
    )

    assert.equal(out, 'page title is **"Welcome"**')
  })

  test("resolves t() — multiple locales shows locale prefixes", () => {
    const messages: MessagesMap = new Map([
      ["en", { "page.title": "Welcome" }],
      ["ru", { "page.title": "Добро пожаловать" }],
    ])
    const out = resolveTranslationKeys(
      "page title is t('page.title')",
      messages,
      ["en", "ru"]
    )

    assert.equal(
      out,
      'page title is **en: "Welcome" · ru: "Добро пожаловать"**'
    )
  })

  test("resolves template-literal t() interpolation", () => {
    const messages: MessagesMap = new Map([["en", { "nav.home": "Home" }]])
    const out = resolveTranslationKeys(
      'navigate to ${t("nav.home")}',
      messages,
      ["en"]
    )

    assert.equal(out, 'navigate to **"Home"**')
  })

  test("leaves missing keys unchanged", () => {
    const messages: MessagesMap = new Map([["en", { "other.key": "Other" }]])
    const out = resolveTranslationKeys("title is t('missing.key')", messages, [
      "en",
    ])

    assert.equal(out, "title is t('missing.key')")
  })

  test("shows only configured locales subset", () => {
    const messages: MessagesMap = new Map([
      ["en", { label: "Hello" }],
      ["ru", { label: "Привет" }],
      ["pt", { label: "Olá" }],
    ])
    const out = resolveTranslationKeys("greet: t('label')", messages, [
      "en",
      "ru",
    ])

    assert.ok(out.includes('**en: "Hello" · ru: "Привет"**'))
    assert.ok(!out.includes("pt"))
  })

  test("resolves parameterised t() with string literal params", () => {
    const messages: MessagesMap = new Map([
      [
        "en",
        {
          "validation.maxLength":
            "{fieldName} must be {max} characters or less",
        },
      ],
      [
        "ru",
        {
          "validation.maxLength":
            "{fieldName} должно содержать не более {max} символов",
        },
      ],
    ])
    const out = resolveTranslationKeys(
      "verify error — t('validation.maxLength', { fieldName: 'Email', max: '254' })",
      messages,
      ["en", "ru"]
    )

    assert.equal(
      out,
      'verify error — **en: "Email must be 254 characters or less" · ru: "Email должно содержать не более 254 символов"**'
    )
  })

  test("resolves parameterised t() with nested t() param", () => {
    const messages: MessagesMap = new Map([
      [
        "en",
        {
          "field.email": "Email",
          "validation.maxLength":
            "{fieldName} must be {max} characters or less",
        },
      ],
      [
        "ru",
        {
          "field.email": "Электронная почта",
          "validation.maxLength":
            "{fieldName} должно содержать не более {max} символов",
        },
      ],
    ])
    const out = resolveTranslationKeys(
      "verify — t('validation.maxLength', { fieldName: t('field.email'), max: '254' })",
      messages,
      ["en", "ru"]
    )

    assert.equal(
      out,
      'verify — **en: "Email must be 254 characters or less" · ru: "Email должно содержать не более 254 символов"**'
    )
  })

  test("leaves parameterised t() unchanged when key is not found", () => {
    const messages: MessagesMap = new Map([["en", { "other.key": "Other" }]])
    const out = resolveTranslationKeys(
      "verify — t('missing.key', { param: 'value' })",
      messages,
      ["en"]
    )

    assert.equal(out, "verify — t('missing.key', { param: 'value' })")
  })
})

describe("loadMessages", () => {
  test("loads and flattens locale files matched by a glob", () => {
    const dir = join(tmpDir, "messages")
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, "en.json"),
      JSON.stringify({ btn: { submit: "Submit" }, hello: "Hello" }),
      "utf-8"
    )
    writeFileSync(
      join(dir, "ru.json"),
      JSON.stringify({ btn: { submit: "Отправить" }, hello: "Привет" }),
      "utf-8"
    )

    const messages = loadMessages("messages/*.json", tmpDir)

    assert.deepEqual(messages.get("en"), {
      "btn.submit": "Submit",
      hello: "Hello",
    })
    assert.deepEqual(messages.get("ru"), {
      "btn.submit": "Отправить",
      hello: "Привет",
    })
  })
})

describe("i18nPlugin", () => {
  test("init loads messages and transformText resolves t() calls", async () => {
    const dir = join(tmpDir, "messages")
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, "en.json"),
      JSON.stringify({ greeting: "Hello" }),
      "utf-8"
    )
    writeFileSync(
      join(dir, "ru.json"),
      JSON.stringify({ greeting: "Привет" }),
      "utf-8"
    )

    const plugin = i18nPlugin({
      locales: ["en", "ru"],
      messages: "messages/*.json",
    })
    await plugin.init?.({ root: tmpDir })

    assert.equal(
      plugin.transformText?.("say t('greeting')"),
      'say **en: "Hello" · ru: "Привет"**'
    )
    assert.deepEqual(plugin.screenshotLocales?.(), ["en", "ru"])
    assert.equal(plugin.name, "i18n")
  })

  test("derives locales from message files when `locales` option is omitted", async () => {
    const dir = join(tmpDir, "messages")
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "en.json"), JSON.stringify({ x: "a" }), "utf-8")
    writeFileSync(join(dir, "ru.json"), JSON.stringify({ x: "б" }), "utf-8")

    const plugin = i18nPlugin({ messages: "messages/*.json" })
    await plugin.init?.({ root: tmpDir })

    assert.deepEqual(plugin.screenshotLocales?.(), ["en", "ru"])
  })

  test("before init: transformText is a pass-through, screenshotLocales is empty", () => {
    const plugin = i18nPlugin({ messages: "messages/*.json" })

    assert.equal(
      plugin.transformText?.("any t('key') here"),
      "any t('key') here"
    )
    assert.deepEqual(plugin.screenshotLocales?.(), [])
  })
})

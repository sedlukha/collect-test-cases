# i18n example

Uses the bundled `collect-test-cases/plugins/i18n` plugin to resolve `t('key')` references inside test titles and step names. The rendered README shows the translated text instead of the key — both for `t('key')` inline form and `${t('key')}` template-literal interpolation.

## What it shows

- Loading locale JSON files via a glob (`messages/*.json`).
- Pinning the locale order (`['en', 'ru']`) — also drives screenshot gallery columns.
- Resolution of:
  - `t('button.submit')` → `**en: "Submit" · ru: "Отправить"**`
  - `` `${t('page.title')}` `` → same, inside a template literal.
  - `t('validation.maxLength', { fieldName: 'Email', max: '254' })` — parameterised, with `{fieldName}` / `{max}` placeholders interpolated.
- Nested-key flattening (`{ button: { submit: 'Submit' } }` → `button.submit`).

## Files

- [`collect-test-cases.config.mjs`](./collect-test-cases.config.mjs) — wires up `i18nPlugin`.
- [`messages/en.json`](./messages/en.json) / [`messages/ru.json`](./messages/ru.json) — locale dictionaries.
- [`__checks__/login-page.spec.ts`](./__checks__/login-page.spec.ts) — spec referencing translation keys.
- [`OUTPUT.md`](./OUTPUT.md) — the generated README with `t(...)` resolved.

## Run it

```bash
cd examples/i18n
npx collect-test-cases
```

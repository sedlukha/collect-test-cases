# Examples

Each subfolder is a self-contained example showing one feature of `collect-test-cases`. Read the example's `README.md` for what it demonstrates and look at the committed `OUTPUT.md` to see exactly what the generator produces — no install required to browse them.

| Example                          | What it shows                                                                                          |
| -------------------------------- | ------------------------------------------------------------------------------------------------------ |
| [basic/](./basic)                | The smallest possible config — one app, no monorepo, default spec type.                                |
| [spec-types/](./spec-types)      | Splitting tests into categories (guest / auth / smoke) via filename patterns.                          |
| [screenshots/](./screenshots)    | Rendering a Playwright screenshot gallery (`gallery: true`) with OS rows.                              |
| [i18n/](./i18n)                  | The bundled `i18n` plugin resolving `t('key')` references in test titles.                              |
| [monorepo/](./monorepo)          | The `layout` block — app filtering via `appsDir`, domain grouping via `routesDir`, and `sharedSpecs`.  |

## Re-generating the OUTPUT.md files

The committed `OUTPUT.md` of each example is checked into git so reviewers can browse the result on GitHub. To re-generate them after changing any example:

```bash
pnpm run regen-examples
```

This builds `dist/`, sets up a self-symlink under `node_modules/collect-test-cases` (so the example configs can `import 'collect-test-cases/plugins/i18n'` from inside the repo), runs the CLI in each example directory, and tears the symlink down.

## Trying an example yourself

Copy any example folder into your own project, then in that project install the package:

```bash
npm install -D collect-test-cases typescript
npx collect-test-cases
```

The CLI walks up from `cwd` until it finds a `collect-test-cases.config.mjs` (or `.js`), reads it, and writes the file the config's `outputPath` points to.

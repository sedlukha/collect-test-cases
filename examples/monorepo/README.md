# monorepo example

Demonstrates the declarative `layout` block on a realistic monorepo shape:

```
examples/monorepo/
├── apps/
│   ├── myapp/web/__checks__/…       ← belongs to "myapp"
│   └── otherapp/web/__checks__/…    ← belongs to "otherapp", excluded from myapp's README
└── packages/
    └── routes/
        └── auth/
            └── web/
                ├── playwright.config.ts   ← appName: ['myapp', 'otherapp']
                └── __checks__/…           ← shared, included for both apps
```

The config lives next to **`apps/myapp/`** and runs for that app; it generates [`OUTPUT.md`](./OUTPUT.md) at the example root (via `outputPath: "../../OUTPUT.md"`) so the explainer and the rendered output sit side by side.

## What it shows

- `layout.appsDir: "apps"` — specs under `apps/myapp/**` are claimed by `appName: "myapp"`; specs under `apps/otherapp/**` are rejected.
- `layout.routesDir: "packages/routes"` — the segment after `routesDir` (here `auth`) becomes the **domain** in the rendered hierarchy (the outermost collapsible block).
- `layout.sharedSpecs: {}` — specs found outside `appsDir` (e.g. `packages/routes/auth/...`) are included only when the nearest `playwright.config.ts` lists this app's name. With more than one app listed, the screenshot gallery would inject the app name into image filenames.
- `scanDirs` — relative paths from the config dir that point upward into the monorepo.

## Files

- [`apps/myapp/collect-test-cases.config.mjs`](./apps/myapp/collect-test-cases.config.mjs) — the layout-driven config.
- `apps/myapp/web/__checks__/*.spec.ts` — myapp's own specs.
- `apps/otherapp/web/__checks__/*.spec.ts` — another app's specs (proves filtering).
- `packages/routes/auth/web/__checks__/*.spec.ts` — shared specs, included via `playwright.config.ts`.
- [`OUTPUT.md`](./OUTPUT.md) — myapp's generated README.

## Run it

```bash
cd examples/monorepo/apps/myapp
npx collect-test-cases
```

# GitHub render probe

A hand-written probe for the Markdown shapes the `render` config emits (see the
[Render options](../README.md#render-options) docs). Push it and open this file
**on GitHub** to confirm the assumptions behind `quote: false` and
`specLink: "heading"` before trusting them:

1. A `<details>` inside a `<details>` with **no `<blockquote>`** still discloses,
   as long as a blank line follows each `</summary>`.
2. A list, a nested list, a table, and a fenced code block all render as Markdown
   inside a quote-less `<details>`.
3. A `<summary>` whose text is an `<a>` link keeps its disclosure triangle
   clickable, and the link is still followable.

---

## Outer group heading (headingLevel)

2 tests

<details>
<summary><strong><a href="./github-render-probe.md">The browser tab of the sign-in page</a></strong> (2 tests)</summary>

- ☑️ shows **"Sign in | Example"**
- ☑️ shows a different tab title from the sign-up page

<details>
<summary>☑️ walks the sign-in flow</summary>

1. open the sign-in page
2. fill the form
3. assert the redirect

</details>

</details>

<details>
<summary><strong>Nested list, table, and code inside a quote-less details</strong> (1 tests)</summary>

- top item
  - nested item
  - another nested item

| OS     | en                 | ru                 |
| ------ | ------------------ | ------------------ |
| ubuntu | ![shot](./x.png)   | ![shot](./x.png)   |
| macOS  | ![shot](./x.png)   | ![shot](./x.png)   |

```ts
test("shows the title", async ({ page }) => {
  await expect(page).toHaveTitle("Sign in | Example")
})
```

</details>

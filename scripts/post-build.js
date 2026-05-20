#!/usr/bin/env node
import { chmodSync, existsSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const binFile = resolve(__dirname, "..", "dist", "cli", "index.js")

if (existsSync(binFile)) {
  chmodSync(binFile, 0o755)
  console.log(`chmod +x ${binFile}`)
} else {
  console.error(`Expected bin file not found: ${binFile}`)
  process.exit(1)
}

// Copies the Radial Keys wheel into the site, so the demo runs the app's real UI: node scripts/sync-radial-keys.mjs [path to radial-keys/src]
import { copyFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const from = resolve(process.argv[2] ?? resolve(root, '../radial-keys/src'))
const to = resolve(root, 'src/radial-keys/app')
if (!existsSync(resolve(from, 'radial.js'))) {
  console.error(`No Radial Keys UI at ${from}.`)
  process.exit(1)
}
for (const file of ['radial.js', 'wheel.js', 'radial.css', 'wheel.css']) copyFileSync(resolve(from, file), resolve(to, file))
console.log(`Copied ${from} -> ${to}`)

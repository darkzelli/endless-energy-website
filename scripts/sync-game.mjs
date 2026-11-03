// Copies the Unity WebGL build into the site: node scripts/sync-game.mjs [path to Builds/WebGL]
import { cpSync, existsSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const from = resolve(process.argv[2] ?? resolve(root, '../un/LoopPower/Builds/WebGL'), 'Build')
const to = resolve(root, 'public/endless-energy/play/Build')
if (!existsSync(from)) {
  console.error(`No WebGL build at ${from}. In Unity: Loop Power > Build for Web.`)
  process.exit(1)
}
rmSync(to, { recursive: true, force: true })
cpSync(from, to, { recursive: true })
console.log(`Copied ${from} -> ${to}`)

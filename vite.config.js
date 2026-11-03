import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'

const root = import.meta.dirname
const partial = (name) => readFileSync(resolve(root, 'src/partials', `${name}.html`), 'utf8')

// The bywhatevermedium site: the studio page at / and each app under its own folder (Endless Energy at /endless-energy/).
// Every app page shares one header and footer: <!-- header --> and <!-- footer --> are swapped for them.
const partials = {
  name: 'partials',
  transformIndexHtml: (html) =>
    html.replace('<!-- header -->', partial('header')).replace('<!-- footer -->', partial('footer')),
}

export default defineConfig({
  plugins: [partials],
  build: {
    rollupOptions: {
      input: {
        home: resolve(root, 'index.html'),
        endlessEnergy: resolve(root, 'endless-energy/index.html'),
        endlessEnergyPrivacy: resolve(root, 'endless-energy/privacy.html'),
        endlessEnergySupport: resolve(root, 'endless-energy/support.html'),
      },
    },
  },
})

The browser version of Endless Energy is turned off for now.

To bring it back: move play.html back into endless-energy/, add
`endlessEnergyPlay: resolve(root, 'endless-energy/play.html')` to the inputs in vite.config.js,
re-add the Play nav link (src/partials/header.html) and the "Play in your browser" button
(endless-energy/index.html), then run `npm run sync-game` after a Unity "Build for Web".

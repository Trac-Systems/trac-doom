// Preload for vanilla doom-wasm smoke test.
// Injects a Module config so Emscripten finds the wasm and preloads doom1.wad/default.cfg.

const fs = require('fs')
const path = require('path')

function resolveFile (...parts) {
  const p = path.join(__dirname, ...parts)
  return fs.existsSync(p) ? p : null
}

function toUint8 (buf) {
  return new Uint8Array(Buffer.from(buf))
}

try {
  const baseVan = ['third_party', 'doom-wasm-vanilla', 'src']
  const baseMod = ['third_party', 'doom-wasm', 'src']
  const base = resolveFile(...baseVan) ? baseVan : baseMod
  const wad = resolveFile(...base, 'doom1.wad') || resolveFile(...base, 'freedoom1.wad')
  const cfg = resolveFile(...base, 'default.cfg')

  const locateDir = path.join(__dirname, ...base)
  const wadBuf = wad ? fs.readFileSync(wad) : null
  const cfgBuf = cfg ? fs.readFileSync(cfg) : null

  const Module = {
    noInitialRun: false,
    arguments: ['-iwad','/doom1.wad','-window','-nomusic','-nosound','-config','default.cfg'],
    locateFile: (p) => path.join(locateDir, p),
    preRun: [function () {
      try {
        if (wadBuf) {
          Module.FS_createDataFile('/', 'doom1.wad', toUint8(wadBuf), true, true)
        }
        if (cfgBuf) {
          Module.FS_createDataFile('/', 'default.cfg', toUint8(cfgBuf), true, true)
        }
      } catch (e) { console.error('[vanilla-preload] FS init failed:', e?.message||e) }
    }]
  }
  // Canvas will be resolved by doom script; we can override if needed
  window.Module = Module
  console.log('[vanilla-preload] Module injected. Base:', locateDir)
} catch (e) {
  console.error('[vanilla-preload] failed:', e)
}

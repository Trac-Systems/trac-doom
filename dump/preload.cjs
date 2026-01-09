// Preload script: start the trac peer in the renderer process before UI loads.
// Uses Node's ESM loader to import ESM modules (trac-peer, trac-msb, app, etc.).

const { pathToFileURL } = require('url')
const path = require('path')

// Minimal preload (kept for future use); no IPC needed.
console.log('[preload] ready')

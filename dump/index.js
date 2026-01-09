import Runtime from 'pear-electron'
import Bridge from 'pear-bridge'

const env = (typeof globalThis !== 'undefined' && globalThis.process && globalThis.process.env)
  ? globalThis.process.env
  : {}
const debug = env.TRAC_DEBUG_PEAR === '1'
const log = (...args) => { if (debug) console.log(...args) }
const logErr = (...args) => { try { console.error(...args) } catch {} }

const wasmThreadFeatures = ['SharedArrayBuffer', 'WebAssemblyThreads']
const enableWasmThreads = !(env.TRAC_ENABLE_WASM_THREADS === '0' || env.TRAC_ENABLE_WASM_THREADS === 'false')
if (enableWasmThreads) {
  const argv = (typeof globalThis !== 'undefined' && globalThis.process && Array.isArray(globalThis.process.argv))
    ? globalThis.process.argv
    : null
  const pearArgv = (typeof globalThis !== 'undefined' && globalThis.Pear && Array.isArray(globalThis.Pear.argv))
    ? globalThis.Pear.argv
    : null
  const targets = [argv, pearArgv].filter(Boolean)
  if (targets.length) {
    const featurePrefix = '--enable-features='
    for (const arr of targets) {
      const idx = arr.findIndex((arg) => typeof arg === 'string' && arg.startsWith(featurePrefix))
      if (idx >= 0) {
        const current = arr[idx].slice(featurePrefix.length).split(',').map((s) => s.trim()).filter(Boolean)
        const set = new Set(current)
        let changed = false
        for (const f of wasmThreadFeatures) {
          if (!set.has(f)) { set.add(f); changed = true }
        }
        if (changed) arr[idx] = `${featurePrefix}${Array.from(set).join(',')}`
      } else {
        // Append after the link arg so pear-cmd treats it as app-args (no UNKNOWN_FLAG).
        arr.push(`${featurePrefix}${wasmThreadFeatures.join(',')}`)
      }
    }
    log('[pear] ensuring wasm thread flags', targets.flat().filter((a) => typeof a === 'string' && a.startsWith(featurePrefix)))
  }
}

const shouldStartPeer = !(env.TRAC_START_PEER === '0' || env.TRAC_START_PEER === 'false' || env.TRAC_NO_PEER === '1')
if (shouldStartPeer) {
  if (typeof globalThis !== 'undefined' && globalThis.process && globalThis.process.env) {
    if (globalThis.process.env.TRAC_INTERACTIVE === undefined) {
      globalThis.process.env.TRAC_INTERACTIVE = '0'
    }
  }
  try {
    await import('./src/main.js')
    log('[pear] backend started')
  } catch (err) {
    logErr('[pear] backend start failed:', err?.message || err)
    if (err?.stack) logErr(err.stack)
    if (typeof Pear !== 'undefined') Pear.exit(1)
    throw err
  }
}

const bridge = new Bridge()
try {
  await bridge.ready()
} catch (err) {
  logErr('[pear] bridge.ready failed:', err?.message || err)
  if (err?.stack) logErr(err.stack)
  if (typeof Pear !== 'undefined') Pear.exit(1)
  throw err
}
log('[pear] bridge ready', { addr: bridge?.addr })

let runtime
try {
  runtime = new Runtime()
} catch (err) {
  logErr('[pear] Runtime ctor failed:', err?.message || err)
  if (err?.stack) logErr(err.stack)
  if (typeof Pear !== 'undefined') Pear.exit(1)
  throw err
}
if (debug) {
  console.log('[pear] config:', {
    main: Pear?.config?.main,
    entrypoint: Pear?.config?.entrypoint,
    assetsUi: Pear?.config?.assets?.ui
  })
}

let pipe
try {
  pipe = await runtime.start({ bridge })
} catch (err) {
  logErr('[pear] runtime.start failed:', err?.message || err)
  if (debug && err?.stack) logErr(err.stack)
  if (typeof Pear !== 'undefined') Pear.exit(1)
  throw err
}
pipe.on('close', () => Pear.exit())

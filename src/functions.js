// Prefer Pear runtime configuration to determine storage path.
// Avoid importing 'process' as a module in browser/Electron ESM; use global.
const process = (typeof globalThis !== 'undefined' && globalThis.process) ? globalThis.process : undefined

export function getStorePath(){
    let store_path = ''
    const pear = (typeof globalThis !== 'undefined' && globalThis.Pear) ? globalThis.Pear : undefined

    // 1) Pear v2: parse pear CLI flags (hypertokens pattern)
    if (store_path === '' && typeof process !== 'undefined' && Array.isArray(process.argv)) {
        try {
            const raw = process.argv[27]
            if (typeof raw === 'string' && raw.startsWith('{')) {
                const args = JSON.parse(raw)
                if (args && args.flags && args.flags.store) store_path = args.flags.store
            }
        } catch {}
    }

    // 2) Pear runtime config (args[0] or storage)
    if (store_path === '' && pear && pear.config) {
        const args = Array.isArray(pear.config.args) ? pear.config.args : []
        if (args.length > 0 && typeof args[0] === 'string' && args[0].length) {
            store_path = args[0]
        } else if (pear.config.storage) {
            store_path = pear.config.storage
        }
    }

    // 3) Explicit CLI flags
    if (store_path === '' && typeof process !== 'undefined' && Array.isArray(process.argv)) {
        const idx = process.argv.indexOf('--store')
        if (idx >= 0 && process.argv[idx + 1]) store_path = process.argv[idx + 1]
    }

    // 4) Legacy Electron/CLI fallbacks
    if (store_path === '' && typeof process !== 'undefined' && Array.isArray(process.argv)) {
        const flag = process.argv.find(a => typeof a === 'string' && a.startsWith('--user-data-dir='))
        if (flag) store_path = flag.split('=').slice(1).join('=')
        if (store_path === '' && process.argv[2] && !String(process.argv[2]).startsWith('--')) {
            store_path = process.argv[2]
        }
    }

    // Default to store2 if not provided (keeps store1 free for indexer/admin)
    if (store_path === '') store_path = 'store2'
    return store_path
}

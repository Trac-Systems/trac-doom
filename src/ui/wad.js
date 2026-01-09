import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

function isNonEmptyString (value) {
  return typeof value === 'string' && value.trim().length > 0
}

export function parsePwads (value) {
  if (!isNonEmptyString(value)) return []
  const raw = value.trim()
  if (!raw) return []
  if (raw.startsWith('[')) {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item || '').trim()).filter(Boolean)
      }
    } catch {}
  }
  return raw.split(',').map((item) => item.trim()).filter(Boolean)
}

export function resolveWadConfig (env = {}, runtimeRoot = '') {
  const errors = []
  const wadDirRaw = isNonEmptyString(env.TRAC_WAD_DIR) ? env.TRAC_WAD_DIR : 'third_party/doom-wasm/src'
  const wadDir = path.isAbsolute(wadDirRaw)
    ? wadDirRaw
    : (runtimeRoot ? path.join(runtimeRoot, wadDirRaw) : wadDirRaw)

  const iwadRaw = isNonEmptyString(env.TRAC_IWAD) ? env.TRAC_IWAD : 'doom1.wad'
  const iwadPath = path.isAbsolute(iwadRaw) ? iwadRaw : path.join(wadDir, iwadRaw)
  const iwadName = path.basename(iwadPath)

  const pwadList = parsePwads(env.TRAC_PWADS)
  const pwadPaths = pwadList.map((entry) => path.isAbsolute(entry) ? entry : path.join(wadDir, entry))
  const pwadNames = pwadPaths.map((entry) => path.basename(entry))

  const seen = new Set([iwadName])
  for (const name of pwadNames) {
    if (seen.has(name)) errors.push(`Duplicate WAD filename detected: ${name}`)
    seen.add(name)
  }

  let wadDirRel = wadDirRaw
  try {
    if (runtimeRoot && path.isAbsolute(wadDir) && wadDir.startsWith(runtimeRoot)) {
      wadDirRel = path.relative(runtimeRoot, wadDir) || wadDirRaw
    }
  } catch {}

  return { wadDir, wadDirRel, iwadPath, iwadName, pwadPaths, pwadNames, errors }
}

export function hashWadEntries (entries) {
  const h = crypto.createHash('sha1')
  for (const entry of entries) {
    const name = String(entry.name || '')
    const buf = entry.buf
    if (!buf || typeof buf.length !== 'number') throw new Error('Invalid WAD buffer for ' + name)
    const nameBuf = Buffer.from(name, 'utf8')
    const nameLen = Buffer.alloc(4)
    nameLen.writeUInt32LE(nameBuf.length >>> 0)
    const sizeBuf = Buffer.alloc(4)
    sizeBuf.writeUInt32LE(buf.length >>> 0)
    h.update(nameLen)
    h.update(nameBuf)
    h.update(sizeBuf)
    h.update(buf)
  }
  return h.digest('hex')
}

export function hashWadBuffer (buf) {
  const h = crypto.createHash('sha1')
  h.update(buf)
  return h.digest('hex')
}

export function getWadTypeFromBuffer (buf) {
  if (!buf || typeof buf.length !== 'number' || buf.length < 4) return null
  const header = Buffer.isBuffer(buf)
    ? buf.slice(0, 4)
    : Buffer.from(buf.buffer ? buf.buffer.slice(buf.byteOffset || 0, (buf.byteOffset || 0) + 4) : buf.slice(0, 4))
  const tag = header.toString('ascii').toUpperCase()
  if (tag === 'IWAD') return 'iwad'
  if (tag === 'PWAD') return 'pwad'
  return null
}

export function listWadMapNames (buf) {
  const out = new Set()
  if (!buf || typeof buf.length !== 'number' || buf.length < 12) return out
  const view = Buffer.isBuffer(buf) ? buf : Buffer.from(buf.buffer ? buf.buffer.slice(buf.byteOffset || 0, (buf.byteOffset || 0) + buf.byteLength) : buf)
  if (view.length < 12) return out
  const numLumps = view.readUInt32LE(4)
  const dirOffset = view.readUInt32LE(8)
  if (!numLumps || !dirOffset || dirOffset < 0) return out
  const dirSize = numLumps * 16
  if ((dirOffset + dirSize) > view.length) return out
  for (let i = 0; i < numLumps; i++) {
    const entryOffset = dirOffset + (i * 16)
    if ((entryOffset + 16) > view.length) break
    const nameBuf = view.slice(entryOffset + 8, entryOffset + 16)
    let name = ''
    for (let j = 0; j < nameBuf.length; j++) {
      const code = nameBuf[j]
      if (!code) break
      name += String.fromCharCode(code)
    }
    const upper = name.toUpperCase()
    if (/^E[1-9]M[1-9]$/.test(upper) || /^MAP[0-9][0-9]$/.test(upper)) {
      out.add(upper)
    }
  }
  return out
}

export async function hashWadFile (filePath) {
  if (fs && fs.readFileSync) {
    try {
      const buf = fs.readFileSync(filePath)
      return hashWadBuffer(buf)
    } catch {}
  }
  if (fs && fs.promises && fs.promises.readFile) {
    const buf = await fs.promises.readFile(filePath)
    return hashWadBuffer(buf)
  }
  throw new Error(`Cannot hash WAD file: ${filePath}`)
}

export async function listWadFiles (dir) {
  if (!dir || typeof dir !== 'string') return []
  const out = []
  if (!fs || !fs.promises || !fs.promises.readdir) return out
  const entries = await fs.promises.readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry || !entry.isFile()) continue
    const name = entry.name || ''
    if (!/\.wad$/i.test(name)) continue
    const full = path.join(dir, name)
    let stat = null
    try { stat = await fs.promises.stat(full) } catch {}
    if (!stat) continue
    let kind = 'unknown'
    try {
      const fh = await fs.promises.open(full, 'r')
      const header = Buffer.alloc(4)
      await fh.read(header, 0, 4, 0)
      await fh.close()
      const tag = header.toString('ascii').toUpperCase()
      if (tag === 'IWAD') kind = 'iwad'
      else if (tag === 'PWAD') kind = 'pwad'
    } catch {}
    out.push({
      name: path.basename(name),
      path: full,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      kind
    })
  }
  out.sort((a, b) => a.name.localeCompare(b.name))
  return out
}

export async function readWadFiles (cfg, { fetcher } = {}) {
  const iwadRel = cfg.iwadRelPath || path.join(cfg.wadDirRel || '', cfg.iwadName)
  const iwadBuf = await readBuffer(cfg.iwadPath, iwadRel, fetcher)
  const iwad = { name: cfg.iwadName, path: cfg.iwadPath, buf: iwadBuf }
  const pwads = []
  for (let i = 0; i < cfg.pwadPaths.length; i++) {
    const p = cfg.pwadPaths[i]
    const name = cfg.pwadNames[i]
    const rel = (Array.isArray(cfg.pwadRelPaths) && cfg.pwadRelPaths[i])
      ? cfg.pwadRelPaths[i]
      : path.join(cfg.wadDirRel || '', name)
    const buf = await readBuffer(p, rel, fetcher)
    pwads.push({ name, path: p, buf })
  }
  const hash = hashWadEntries([iwad, ...pwads])
  return { iwad, pwads, hash }
}

async function readBuffer (filePath, relPath, fetcher) {
  if (fs && fs.readFileSync) {
    try {
      return fs.readFileSync(filePath)
    } catch {}
  }
  if (typeof fetcher === 'function') {
    const pathForFetch = relPath ? relPath.replace(/\\/g, '/') : filePath
    const res = await fetcher(pathForFetch)
    if (!res.ok) throw new Error(`Failed to fetch ${filePath}`)
    const ab = await res.arrayBuffer()
    return new Uint8Array(ab)
  }
  throw new Error(`Cannot read WAD file: ${filePath}`)
}

export function parseWarpInput (input) {
  const raw = (input || '').trim().toUpperCase()
  if (!raw) return { args: null, label: '' }
  let m = raw.match(/^E(\d)M(\d)$/)
  if (m) return { args: ['-warp', m[1], m[2]], label: raw }
  m = raw.match(/^MAP(\d{1,2})$/)
  if (m) return { args: ['-warp', String(parseInt(m[1], 10))], label: `MAP${String(parseInt(m[1], 10)).padStart(2, '0')}` }
  m = raw.match(/^(\d+)\s+(\d+)$/)
  if (m) return { args: ['-warp', m[1], m[2]], label: `E${m[1]}M${m[2]}` }
  if (/^\d{1,2}$/.test(raw)) {
    return { args: ['-warp', String(parseInt(raw, 10))], label: `MAP${String(parseInt(raw, 10)).padStart(2, '0')}` }
  }
  return { error: 'invalid', label: raw }
}

export function mapPlaceholder (iwadName) {
  const name = String(iwadName || '').toLowerCase()
  if (name.includes('doom2') || name.includes('plutonia') || name.includes('tnt') || name.includes('evilution')) {
    return 'MAP01'
  }
  return 'E1M1'
}

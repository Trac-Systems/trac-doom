let WebSocketServer
let BareWebSocket
let wsKind = 'ws'
try {
  const m = await import('ws')
  const candidate = m.WebSocketServer || m.Server || (m.default && (m.default.WebSocketServer || m.default.Server))
  if (!candidate || typeof candidate.prototype?.handleUpgrade !== 'function') {
    throw new Error('ws WebSocketServer not available')
  }
  WebSocketServer = candidate
} catch {
  const m = await import('bare-ws')
  WebSocketServer = (m.default && m.default.Server) || m.Server || m.default || m
  BareWebSocket = (m.default && m.default.Socket) || m.Socket
  wsKind = 'bare'
}
import Protomux from 'protomux'
import c from 'compact-encoding'
import { createServer } from 'http'
import Hyperswarm from 'hyperswarm'
import b4a from 'b4a'
import crypto from 'node:crypto'
import sodium from 'sodium-native'

const env = (typeof process !== 'undefined' && process.env) ? process.env : {}
const LOG_LEVELS = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 }
const wsLogLevel = (() => {
  const raw = (env.TRAC_WS_LOG_LEVEL || env.TRAC_LOG_LEVEL || '').toLowerCase()
  if (env.TRAC_WS_LOG === '1' || env.TRAC_WS_LOG === 'true' || env.TRAC_WS_DEBUG === '1') return 'debug'
  if (env.TRAC_QUIET === '1' || env.TRAC_QUIET === 'true') return 'error'
  return LOG_LEVELS[raw] != null ? raw : 'warn'
})()
const ENVELOPE_VERSION = 1
const SIG_BYTES = sodium.crypto_sign_BYTES || 64
const HASH_BYTES = sodium.crypto_hash_sha256_BYTES || 32
const RATE_LIMIT = (() => {
  const raw = parseInt(env.TRAC_GAME_RATE_LIMIT || env.TRAC_RATE_LIMIT || '200', 10)
  return Number.isFinite(raw) && raw > 0 ? raw : 200
})()
const RATE_WINDOW_MS = 1000
const ROSTER_CACHE_MS = 2000
const PENDING_ROSTER_TTL_MS = 5000
const PENDING_ROSTER_MAX = 32

function log (level, ...args) {
  const lvl = LOG_LEVELS[level] != null ? level : 'info'
  if (LOG_LEVELS[lvl] > LOG_LEVELS[wsLogLevel]) return
  if (lvl === 'error') console.error(...args)
  else if (lvl === 'warn') console.warn(...args)
  else console.log(...args)
}

// Server-side Doom net bridge over WebSocket.
// - Renderer connects via WS and sends game packets (binary frames) and control JSON messages.
// - This bridge forwards packets to peer.swarm over Protomux channels and relays incoming packets back to the renderer.

export function attachDoomWSBridge (peer, { port = 7788, host = '127.0.0.1', disableWS = false } = {}) {
  // Optional WS servers (paths: /doom, /meta). Always attach p2p forwarder regardless of WS.
  const httpServer = disableWS ? null : createServer((req, res) => {
    res.statusCode = 404
    res.end('Not found')
  })
  const presenceTtlMs = 12000
  const matchTtlMsRaw = (typeof process !== 'undefined' && process.env && process.env.TRAC_MATCH_TTL_MS)
    ? parseInt(process.env.TRAC_MATCH_TTL_MS, 10)
    : null
  const matchTtlMs = Number.isFinite(matchTtlMsRaw) ? matchTtlMsRaw : 120000
  const useBare = wsKind === 'bare'
  const doomWSS = (disableWS || useBare) ? null : new WebSocketServer({ noServer: true })
  const metaWSS = (disableWS || useBare) ? null : new WebSocketServer({ noServer: true })
  const state = {
    clients: new Set(), // { ws, kind, isServer, selfUid, game: { id, seq }, local: { address, nick } }
    games: new Set(),   // known gids
    lastGid: null,
    gameInfo: new Map(), // gid -> { mode, noMonsters }
    matches: new Map(), // gid -> match metadata
    matchSwarm: null, // active match swarm (one at a time)
    matchTopic: null, // hex string
    matchGid: null,
    uidRoute: new Map(), // uid -> connection
    channels: new Map(), // swarmConnection -> Map(gid -> { message })
    defaultChannels: new Map(), // swarmConnection -> { message }
    meta: {
      map: new Map(), // uid -> { address, nick }
      channels: new Map() // swarmConnection -> { message }
    },
    presence: new Map(), // address -> { address, nick, status, matchGid, clientId, lastSeenMs }
    seen: new Map(), // key -> Map(hash -> timestamp)
    gameQueue: [], // { gid, buf, to, from, ts }
    rosterCache: new Map(), // gid -> Map(uid -> { addr, active, ts })
    pendingRoster: new Map(), // key -> { ts, entries: [{ buf, gid, uid, conn }] }
    joinAttempts: new Map(), // key -> { ts, ok }
    rateLimit: new Map(), // uid -> { tokens, ts }
    seqOut: new Map(), // key -> seq
    seqIn: new Map(), // key -> seq
    stats: {
      gameRx: 0,
      gameTx: 0,
      gameFwd: 0,
      gameDrop: 0,
      invalidSig: 0,
      unknownUid: 0,
      replay: 0,
      rateLimited: 0
    }
  }
  const gameReadyCache = new Map()
  const gameQueueMaxAgeMs = 10000
  const gameQueueMaxItems = 256

  function makeMatchTopic (gid) {
    const h = crypto.createHash('sha256')
    h.update('tracdoom-match:')
    h.update(String(peer?.options?.channel || ''))
    h.update(':')
    h.update(String(gid || ''))
    return h.digest()
  }

  function normalizeMatchTopicHex (gid, matchTopic) {
    if (matchTopic && (matchTopic instanceof Uint8Array || Buffer.isBuffer(matchTopic))) {
      return Buffer.from(matchTopic).toString('hex')
    }
    if (typeof matchTopic === 'string' && /^[0-9a-fA-F]{64}$/.test(matchTopic)) {
      return matchTopic.toLowerCase()
    }
    return makeMatchTopic(gid).toString('hex')
  }

  function gameConnections () {
    if (!state.matchSwarm || !state.matchSwarm.connections) return []
    return Array.from(state.matchSwarm.connections)
  }

  function matchConnectionCount () {
    const swarm = state.matchSwarm
    if (!swarm || !swarm.connections) return 0
    if (typeof swarm.connections.size === 'number') return swarm.connections.size
    if (typeof swarm.connections.length === 'number') return swarm.connections.length
    try { return Array.from(swarm.connections).length } catch { return 0 }
  }

  function queueGameFrame (gid, buf, to, from) {
    const now = Date.now()
    const queue = state.gameQueue
    const cutoff = now - gameQueueMaxAgeMs
    if (queue.length) {
      let drop = 0
      for (const entry of queue) {
        if (!entry || entry.ts < cutoff) drop++
        else break
      }
      if (drop) queue.splice(0, drop)
    }
    if (queue.length >= gameQueueMaxItems) {
      queue.splice(0, queue.length - gameQueueMaxItems + 1)
    }
    let out = buf
    try { if (buf && typeof buf.slice === 'function') out = buf.slice() } catch {}
    queue.push({ gid, buf: out, to: to >>> 0, from: from >>> 0, ts: now })
  }

  function flushGameQueue () {
    const conns = gameConnections()
    if (!conns.length) return 0
    const queue = state.gameQueue
    if (!queue.length) return 0
    const now = Date.now()
    const cutoff = now - gameQueueMaxAgeMs
    let sent = 0
    for (const entry of queue) {
      if (!entry || !entry.buf) continue
      if (entry.ts < cutoff) continue
      const gid = entry.gid || state.matchGid || state.lastGid
      if (!gid) continue
      ensureGid(gid)
      let localSent = 0
      try {
        const to = entry.to >>> 0
        if (to !== 0) {
          const dest = selectRoute(to, null)
          if (dest) {
            ensureGameChannel(dest, gid).message.send(entry.buf)
            localSent = 1
          } else {
            for (const conn of conns) { ensureGameChannel(conn, gid).message.send(entry.buf); localSent++ }
          }
        } else {
          for (const conn of conns) { ensureGameChannel(conn, gid).message.send(entry.buf); localSent++ }
        }
      } catch {}
      sent += localSent
      if (localSent) state.stats.gameTx += localSent
    }
    state.gameQueue = []
    try { if (sent) log('debug', `[ws-bridge] flushed ${sent} queued frames`) } catch {}
    return sent
  }

  function destroyMatchSwarm (reason) {
    const swarm = state.matchSwarm
    state.matchSwarm = null
    state.matchTopic = null
    state.matchGid = null
    state.games = new Set()
    state.lastGid = null
    state.uidRoute = new Map()
    state.channels = new Map()
    state.defaultChannels = new Map()
    state.gameQueue = []
    state.rosterCache = new Map()
    state.pendingRoster = new Map()
    state.joinAttempts = new Map()
    state.rateLimit = new Map()
    state.seqOut = new Map()
    state.seqIn = new Map()
    try { globalThis.__lastServerPresenceRaw = null } catch {}
    try { globalThis.__lastServerPresenceEnv = null } catch {}
    try { if (swarm && typeof swarm.destroy === 'function') swarm.destroy() } catch {}
    try { if (peer) { peer._matchSwarm = null; peer._matchTopic = null; peer._matchGid = null } } catch {}
    if (reason) {
      try { log('info', '[ws-bridge] match swarm closed:', reason) } catch {}
    }
  }

  function ensureMatchSwarm (gid, matchTopic) {
    if (!gid) return
    const topicHex = normalizeMatchTopicHex(gid, matchTopic)
    if (state.matchSwarm && state.matchGid === gid && state.matchTopic === topicHex) return
    if (state.matchSwarm) destroyMatchSwarm('switch')
    let keyPair = null
    try {
      if (peer?.wallet?.publicKey && peer?.wallet?.secretKey) {
        keyPair = {
          publicKey: b4a.from(peer.wallet.publicKey, 'hex'),
          secretKey: b4a.from(peer.wallet.secretKey, 'hex')
        }
      }
    } catch {}
    const createSwarm = peer?._createMatchSwarm || ((opts) => new Hyperswarm(opts))
    const topic = Buffer.from(topicHex, 'hex')
    let swarm = null
    try {
      const opts = { bootstrap: peer?.dhtBootstrap, topic, gid }
      if (keyPair) opts.keyPair = keyPair
      swarm = createSwarm(opts)
    } catch (e) {
      log('error', '[ws-bridge] match swarm create failed:', e?.message || e)
      return
    }
    state.matchSwarm = swarm
    state.matchGid = gid
    state.matchTopic = topicHex
    state.games = new Set([gid])
    state.lastGid = gid
    try { peer._matchSwarm = swarm; peer._matchTopic = topicHex; peer._matchGid = gid } catch {}
    try {
      if (typeof swarm.join === 'function') {
        swarm.join(topic, { server: true, client: true })
        if (typeof swarm.flush === 'function') swarm.flush()
      }
    } catch {}
    try {
      swarm.on('connection', (connection) => {
        ensureGameChannel(connection, gid)
        sendServerPresence(connection)
        flushGameQueue()
      })
    } catch {}
    try {
      for (const conn of swarm.connections || []) {
        ensureGameChannel(conn, gid)
        sendServerPresence(conn)
      }
      flushGameQueue()
    } catch {}
  }

  function upsertPresence (msg) {
    if (!msg || !msg.address) return
    const addr = String(msg.address)
    const now = Date.now()
    const prev = state.presence.get(addr) || {}
    state.presence.set(addr, {
      ...prev,
      address: addr,
      nick: msg.nick || prev.nick || null,
      status: msg.status || prev.status || null,
      matchGid: msg.matchGid || prev.matchGid || null,
      clientId: msg.clientId || prev.clientId || null,
      lastSeenMs: now
    })
  }

  function prunePresence () {
    const now = Date.now()
    for (const [addr, info] of state.presence.entries()) {
      if (!info || !info.lastSeenMs || (now - info.lastSeenMs) > presenceTtlMs) {
        state.presence.delete(addr)
      }
    }
  }

  async function isGameReady (gid) {
    if (!gid) return false
    const now = Date.now()
    const cached = gameReadyCache.get(gid)
    if (cached && (now - cached.ts) < 1000) return cached.ok
    let ok = false
    try {
      if (peer?.base?.view?.get) {
        const serverRec = await peer.base.view.get(`game/${gid}/server`)
        const activeRec = await peer.base.view.get(`game/${gid}/active`)
        const server = serverRec && serverRec.value != null ? String(serverRec.value) : null
        const active = activeRec && activeRec.value != null ? activeRec.value : null
        const selfAddr = peer?.wallet?.publicKey ? String(peer.wallet.publicKey) : null
        ok = !!server && !!selfAddr && server === selfAddr && (active === 1 || active === '1')
      }
    } catch {}
    gameReadyCache.set(gid, { ok, ts: now })
    return ok
  }

  function fnv1a32 (u8) {
    let h = 0x811c9dc5 >>> 0
    for (let i = 0; i < u8.length; i++) { h ^= u8[i]; h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0 }
    return h >>> 0
  }

  function seenOnce (key, buf, ttlMs = 1000) {
    const now = Date.now()
    let m = state.seen.get(key)
    if (!m) { m = new Map(); state.seen.set(key, m) }
    const cutoff = now - ttlMs
    for (const [k, ts] of m.entries()) { if (ts < cutoff) m.delete(k) }
    const h = fnv1a32(buf)
    if (m.has(h)) return true
    m.set(h, now)
    // bound map growth
    if (m.size > 2048) {
      let cnt = 0
      for (const k of m.keys()) { m.delete(k); if (++cnt > 128) break }
    }
    return false
  }

  function allowRate (uid) {
    const key = uid >>> 0
    const now = Date.now()
    const entry = state.rateLimit.get(key) || { tokens: RATE_LIMIT, ts: now }
    const elapsed = now - entry.ts
    if (elapsed > 0) {
      const refill = (elapsed / RATE_WINDOW_MS) * RATE_LIMIT
      entry.tokens = Math.min(RATE_LIMIT, entry.tokens + refill)
      entry.ts = now
    }
    if (entry.tokens < 1) {
      state.rateLimit.set(key, entry)
      return false
    }
    entry.tokens -= 1
    state.rateLimit.set(key, entry)
    return true
  }

  function hashEnvelope (gid, uid, seq, payload) {
    const gidBuf = Buffer.from(String(gid || ''), 'utf8')
    const payloadBuf = Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength)
    const size = 2 + gidBuf.length + 4 + 4 + payloadBuf.length
    const buf = Buffer.allocUnsafe(size)
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
    dv.setUint16(0, gidBuf.length, true)
    buf.set(gidBuf, 2)
    dv.setUint32(2 + gidBuf.length, uid >>> 0, true)
    dv.setUint32(2 + gidBuf.length + 4, seq >>> 0, true)
    buf.set(payloadBuf, 2 + gidBuf.length + 8)
    const out = Buffer.allocUnsafe(HASH_BYTES)
    sodium.crypto_hash_sha256(out, buf)
    return out
  }

  function signEnvelope (gid, uid, seq, payload) {
    const hash = hashEnvelope(gid, uid, seq, payload)
    const sigHex = peer?.wallet?.sign ? peer.wallet.sign(hash) : null
    if (!sigHex) return null
    return Buffer.from(sigHex, 'hex')
  }

  function verifyEnvelope (sig, gid, uid, seq, payload, publicKey) {
    if (!sig || !publicKey || !peer?.wallet?.verify) return false
    const hash = hashEnvelope(gid, uid, seq, payload)
    return peer.wallet.verify(sig, hash, publicKey)
  }

  function encodeEnvelope (gid, uid, seq, payload, sig) {
    const gidBuf = Buffer.from(String(gid || ''), 'utf8')
    const total = 1 + 2 + gidBuf.length + 4 + 4 + SIG_BYTES + payload.byteLength
    const out = new Uint8Array(total)
    const dv = new DataView(out.buffer)
    out[0] = ENVELOPE_VERSION
    dv.setUint16(1, gidBuf.length, true)
    out.set(gidBuf, 3)
    let offset = 3 + gidBuf.length
    dv.setUint32(offset, uid >>> 0, true)
    dv.setUint32(offset + 4, seq >>> 0, true)
    offset += 8
    if (sig && sig.length === SIG_BYTES) out.set(sig, offset)
    else out.set(new Uint8Array(SIG_BYTES), offset)
    offset += SIG_BYTES
    out.set(payload, offset)
    return out
  }

  function decodeEnvelope (buf) {
    const u8 = (buf instanceof Uint8Array) ? buf : new Uint8Array(buf)
    if (u8.byteLength < (1 + 2 + 4 + 4 + SIG_BYTES)) return null
    if (u8[0] !== ENVELOPE_VERSION) return null
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength)
    const gidLen = dv.getUint16(1, true)
    const gidStart = 3
    const gidEnd = gidStart + gidLen
    if (u8.byteLength < (gidEnd + 4 + 4 + SIG_BYTES)) return null
    const gid = Buffer.from(u8.subarray(gidStart, gidEnd)).toString('utf8')
    const uid = dv.getUint32(gidEnd, true)
    const seq = dv.getUint32(gidEnd + 4, true)
    const sigStart = gidEnd + 8
    const sig = u8.subarray(sigStart, sigStart + SIG_BYTES)
    const payload = u8.subarray(sigStart + SIG_BYTES)
    return { gid, uid, seq, sig, payload }
  }

  async function getRosterEntry (gid, uid) {
    const gidKey = String(gid || '')
    const uidKey = uid >>> 0
    let cache = state.rosterCache.get(gidKey)
    if (!cache) { cache = new Map(); state.rosterCache.set(gidKey, cache) }
    const cached = cache.get(uidKey)
    const now = Date.now()
    if (cached && (now - cached.ts) < ROSTER_CACHE_MS) return cached
    if (!peer?.base?.view?.get) return null
    let addr = null
    let active = null
    let gameActive = null
    try {
      const rec = await peer.base.view.get(`game/${gidKey}/roster/${uidKey}`)
      addr = rec && rec.value != null ? String(rec.value) : null
      const actRec = await peer.base.view.get(`game/${gidKey}/roster_active/${uidKey}`)
      active = actRec && actRec.value != null ? actRec.value : null
      const gameRec = await peer.base.view.get(`game/${gidKey}/active`)
      gameActive = gameRec && gameRec.value != null ? gameRec.value : null
    } catch {}
    const activeOk = (active === null || active === undefined || active === 1 || active === '1')
    const gameOk = (gameActive === null || gameActive === undefined || gameActive === 1 || gameActive === '1')
    const entry = (addr && activeOk && gameOk) ? { addr, ts: now } : null
    cache.set(uidKey, entry)
    return entry
  }

  function prunePendingRoster () {
    const now = Date.now()
    for (const [key, pending] of state.pendingRoster.entries()) {
      if (!pending || !pending.ts || (now - pending.ts) > PENDING_ROSTER_TTL_MS) {
        state.pendingRoster.delete(key)
      }
    }
  }

  function queuePendingRoster (gid, uid, buf, connection) {
    const key = `${gid}:${uid >>> 0}`
    const now = Date.now()
    let pending = state.pendingRoster.get(key)
    if (!pending) {
      pending = { ts: now, entries: [] }
      state.pendingRoster.set(key, pending)
    }
    pending.ts = now
    if (pending.entries.length >= PENDING_ROSTER_MAX) return
    pending.entries.push({ buf, gid, uid, conn: connection, ts: now })
  }

  function metaSeen (msg) {
    let key = null
    if (msg && typeof msg === 'object' && msg.rid) key = `rid:${msg.rid}`
    if (!key) {
      try { key = `raw:${JSON.stringify(msg)}` } catch {}
    }
    if (!key) return false
    try { return seenOnce('meta', Buffer.from(String(key), 'utf8'), 5000) } catch {}
    return false
  }

  function ensureMetaRid (msg) {
    if (!msg || typeof msg !== 'object') return
    if (msg.rid) return
    const stamp = Date.now().toString(16)
    const rand = Math.random().toString(16).slice(2)
    msg.rid = `${stamp}${rand}`
  }

  function getMux (connection) {
    const existing = connection && connection.userData
    if (existing && existing.isProtomux) return existing
    const mux = Protomux.from(connection)
    if (connection && (!connection.userData || !connection.userData.isProtomux)) {
      connection.userData = mux
    }
    return mux
  }

  function isConnAlive (conn) {
    if (!conn) return false
    if (conn.destroyed) return false
    if (conn.closed) return false
    return true
  }

  function rememberRoute (uid, connection) {
    if (!uid || !connection) return
    state.uidRoute.set(uid >>> 0, connection)
  }

  function selectRoute (uid, excludeConn = null) {
    if (!uid) return null
    const dest = state.uidRoute.get(uid >>> 0)
    if (!dest || dest === excludeConn) return null
    return isConnAlive(dest) ? dest : null
  }

  function deliverToDoomClients (to, from, payload) {
    let delivered = 0
    let doomClients = 0
    let unknown = null
    let unknownCount = 0
    for (const cli of state.clients) {
      if (cli.kind !== 'doom') continue
      doomClients++
      if (to !== 0) {
        if (cli.selfUid == null) { unknown = cli; unknownCount++; continue }
        if ((cli.selfUid >>> 0) !== to) continue
      }
      const out = new Uint8Array(4 + payload.byteLength)
      new DataView(out.buffer).setUint32(0, from >>> 0, true)
      out.set(payload, 4)
      try { if (wsSend(cli.ws, out)) delivered++ } catch {}
    }
    // Fallback: if target is known but UID isn't yet, allow single-client handshake
    if (delivered === 0 && to !== 0 && unknownCount === 1 && unknown) {
      const out = new Uint8Array(4 + payload.byteLength)
      new DataView(out.buffer).setUint32(0, from >>> 0, true)
      out.set(payload, 4)
      try { if (wsSend(unknown.ws, out)) delivered++ } catch {}
    }
    return delivered
  }

  async function ensureJoinGame (gid, uid) {
    if (!gid || !uid) return
    if (!peer?.protocol_instance?.api?.joinGame) return
    const key = `${gid}:${uid >>> 0}`
    const now = Date.now()
    const prev = state.joinAttempts.get(key)
    if (prev && (now - prev.ts) < 5000) return
    state.joinAttempts.set(key, { ts: now, ok: false })
    try {
      await peer.protocol_instance.api.joinGame(gid, uid >>> 0)
      state.joinAttempts.set(key, { ts: Date.now(), ok: true })
    } catch {
      state.joinAttempts.delete(key)
    }
  }

  function handleVerifiedEnvelope (env, rawBuf, connection, forwardMode = 'game') {
    const payload = env.payload
    if (!(payload instanceof Uint8Array) || payload.byteLength < 8) {
      state.stats.gameDrop++
      return
    }
    const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
    const to = view.getUint32(0, true)
    const from = view.getUint32(4, true)
    if ((from >>> 0) !== (env.uid >>> 0)) {
      state.stats.invalidSig++
      state.stats.gameDrop++
      return
    }
    rememberRoute(from, connection)
    const delivered = deliverToDoomClients(to, from, payload.subarray(8))
    if (delivered === 0) {
      try { log('debug', `[ws-bridge] p2p->ws drop gid=${env.gid} to=${to} from=${from} clients=${state.clients.size}`) } catch {}
    }
    state.stats.gameRx++
    // Forward to other swarm connections (multi-hop), except the one we received from
    try {
      const useDefault = forwardMode === 'default'
      const conns = useDefault
        ? Array.from(peer?.swarm?.connections || [])
        : gameConnections()
      let fwd = 0
      if (to !== 0) {
        const dest = selectRoute(to, connection)
        if (dest) {
          if (useDefault) ensureDefaultChannel(dest).message.send(rawBuf)
          else ensureGameChannel(dest, env.gid).message.send(rawBuf)
          fwd = 1
        } else {
          for (const conn of conns) {
            if (conn === connection) continue
            if (useDefault) ensureDefaultChannel(conn).message.send(rawBuf)
            else ensureGameChannel(conn, env.gid).message.send(rawBuf)
            fwd++
          }
        }
      } else {
        for (const conn of conns) {
          if (conn === connection) continue
          if (useDefault) ensureDefaultChannel(conn).message.send(rawBuf)
          else ensureGameChannel(conn, env.gid).message.send(rawBuf)
          fwd++
        }
      }
      if (fwd) {
        state.stats.gameFwd += fwd
        log('debug', `[ws-bridge] p2p->p2p fwd gid=${env.gid} to=${to} from=${from} hops=${fwd}`)
      }
    } catch {}
  }

  async function processEnvelope (buf, connection, expectedGid, forwardMode = 'game') {
    let envObj = null
    try { envObj = decodeEnvelope(buf) } catch {}
    if (!envObj || !envObj.payload) {
      state.stats.gameDrop++
      return
    }
    if (expectedGid && String(envObj.gid) !== String(expectedGid)) {
      state.stats.gameDrop++
      return
    }
    const uid = envObj.uid >>> 0
    prunePendingRoster()
    if (!allowRate(uid)) {
      state.stats.rateLimited++
      state.stats.gameDrop++
      return
    }
    const roster = await getRosterEntry(envObj.gid, uid)
    if (!roster || !roster.addr) {
      state.stats.unknownUid++
      queuePendingRoster(envObj.gid, uid, buf, connection)
      return
    }
    const seqKey = `${envObj.gid}:${uid}`
    const last = state.seqIn.get(seqKey) || 0
    if (envObj.seq <= last) {
      state.stats.replay++
      state.stats.gameDrop++
      return
    }
    if (!verifyEnvelope(envObj.sig, envObj.gid, uid, envObj.seq, envObj.payload, roster.addr)) {
      state.stats.invalidSig++
      state.stats.gameDrop++
      return
    }
    state.seqIn.set(seqKey, envObj.seq)
    handleVerifiedEnvelope(envObj, buf, connection, forwardMode)

    const pendingKey = `${envObj.gid}:${uid}`
    const pending = state.pendingRoster.get(pendingKey)
    if (pending && pending.entries && pending.entries.length) {
      state.pendingRoster.delete(pendingKey)
      for (const entry of pending.entries) {
        try {
          const queued = decodeEnvelope(entry.buf)
          if (!queued) continue
          if (String(queued.gid) !== String(envObj.gid) || (queued.uid >>> 0) !== uid) continue
          if (!verifyEnvelope(queued.sig, queued.gid, uid, queued.seq, queued.payload, roster.addr)) {
            state.stats.invalidSig++
            state.stats.gameDrop++
            continue
          }
          const lastSeq = state.seqIn.get(seqKey) || 0
          if (queued.seq <= lastSeq) {
            state.stats.replay++
            state.stats.gameDrop++
            continue
          }
          state.seqIn.set(seqKey, queued.seq)
          handleVerifiedEnvelope(queued, entry.buf, entry.conn, forwardMode)
        } catch {}
      }
    }
  }

  function ensureGameChannel (connection, gid) {
    // per-gid Protomux channel so multiple matches don’t collide
    let byGid = state.channels.get(connection)
    if (!byGid) { byGid = new Map(); state.channels.set(connection, byGid) }
    if (byGid.has(gid)) return byGid.get(gid)
    const mux = getMux(connection)
    const proto = `doom-p2p/${gid}`
    const ch = mux.createChannel({ protocol: proto, onopen () {}, onclose () {} })
    ch.open()
    const message = ch.addMessage({ encoding: c.raw, onmessage (buf) {
      try {
        if (!(buf instanceof Uint8Array)) return
        if (seenOnce('gid:'+gid, buf)) return
        void processEnvelope(buf, connection, gid, 'game')
      } catch {}
    }})
    const obj = { message }
    byGid.set(gid, obj)
    return obj
  }

  function ensureGid (gid) {
    if (!gid) return
    if (state.games.has(gid)) return
    state.games.add(gid)
    for (const conn of gameConnections()) ensureGameChannel(conn, gid)
  }

  function ensureDefaultChannel (connection) {
    if (state.defaultChannels.has(connection)) return state.defaultChannels.get(connection)
    const mux = getMux(connection)
    const ch = mux.createChannel({ protocol: 'doom-p2p', onopen () {}, onclose () {} })
    ch.open()
    const message = ch.addMessage({ encoding: c.raw, onmessage (buf) {
      try {
        if (!(buf instanceof Uint8Array)) return
        if (seenOnce('default', buf)) return
        void processEnvelope(buf, connection, null, 'default')
      } catch {}
    }})
    const obj = { message }
    state.defaultChannels.set(connection, obj)
    return obj
  }

  function ensureMetaChannel (connection) {
    if (state.meta.channels.has(connection)) return state.meta.channels.get(connection)
    const mux = getMux(connection)
    const ch = mux.createChannel({ protocol: 'doom-p2p-meta', onopen () {}, onclose () {} })
    ch.open()
    const message = ch.addMessage({ encoding: c.json, onmessage (msg) {
      try { handleMetaMessage(msg, connection) } catch {}
    }})
    const obj = { message }
    state.meta.channels.set(connection, obj)
    return obj
  }

  function sendMetaDirect (connection, msg) {
    if (!connection || !msg) return
    try { ensureMetaChannel(connection).message.send(msg) } catch {}
  }

  function sendMetaToPeers (msg, exceptConn = null) {
    if (!peer.swarm) return
    for (const conn of peer.swarm.connections) {
      if (conn === exceptConn) continue
      sendMetaDirect(conn, msg)
    }
  }

  function handleMetaMessage (msg, connection) {
    if (!msg || typeof msg !== 'object') return
    if (metaSeen(msg)) return
    if (msg && msg.t === 'hello' && typeof msg.uid === 'number' && typeof msg.address === 'string') {
      state.meta.map.set(msg.uid >>> 0, { address: msg.address, nick: msg.nick || null })
      if (msg.gid) {
        const g = String(msg.gid)
        ensureGid(g)
        if (!state.lastGid) state.lastGid = g
      }
    }
    if (msg && msg.t === 'mode' && msg.gid) {
      const g = String(msg.gid)
      const mode = normalizeMode(msg.mode)
      const noMonsters = !!msg.noMonsters
      state.gameInfo.set(g, { mode, noMonsters })
      sendMetaToLocalClients({ t: 'mode', gid: g, mode, noMonsters })
    }
    if (msg && msg.t === 'presence') {
      upsertPresence(msg)
      sendMetaToLocalClients(msg)
    }
    if (msg && msg.t === 'match-list-req') {
      sendMetaSnapshot(connection)
    }
    if (msg && (msg.t === 'match-announce' || msg.t === 'match-update' || msg.t === 'match-start' || msg.t === 'match-end')) {
      if (peer?.base?.isIndexer && msg.gid && msg.t !== 'match-end') {
        const g = String(msg.gid)
        const topic = msg.matchTopic || normalizeMatchTopicHex(g, msg.matchTopic)
        ensureMatchSwarm(g, topic)
      }
      if (msg.gid && !msg.matchTopic) {
        msg.matchTopic = normalizeMatchTopicHex(String(msg.gid), msg.matchTopic)
      }
      applyMatchUpdate(msg)
      sendMetaToLocalClients(msg)
      if (msg.t === 'match-end' && msg.gid && state.matchGid === String(msg.gid)) {
        destroyMatchSwarm('match-end')
      }
    }
    if (msg && (msg.t === 'match-join' || msg.t === 'match-accept' || msg.t === 'match-deny' || msg.t === 'match-leave')) {
      sendMetaToLocalClients(msg)
      if (msg.t === 'match-accept' && msg.to && peer?.wallet?.publicKey && msg.gid) {
        if (msg.to === peer.wallet.publicKey) {
          const gid = String(msg.gid)
          const match = msg.match || state.matches.get(gid)
          const topic = match?.matchTopic || msg.matchTopic
          ensureMatchSwarm(gid, topic)
        }
      }
      if (msg.t === 'match-deny' && msg.to && peer?.wallet?.publicKey && msg.gid) {
        if (msg.to === peer.wallet.publicKey && state.matchGid === String(msg.gid)) {
          destroyMatchSwarm('match-deny')
        }
      }
    }
    if (msg && msg.t === 'chat') {
      sendMetaToLocalClients(msg)
    }
    sendMetaToPeers(msg, connection)
  }

  function sendMetaSnapshot (connection) {
    try {
      pruneMatches()
      let gid = state.lastGid
      if (!gid && state.games.size === 1) gid = state.games.values().next().value
      if (gid) {
        const addrInfo = state.meta.map.get(1) || state.meta.map.get(0) || null
        sendMetaDirect(connection, {
          t: 'hello',
          uid: 1,
          address: addrInfo?.address || '',
          nick: addrInfo?.nick || null,
          gid
        })
      }
      for (const [g, info] of state.gameInfo.entries()) {
        sendMetaDirect(connection, { t: 'mode', gid: g, mode: info.mode, noMonsters: !!info.noMonsters })
      }
      for (const [g, match] of state.matches.entries()) {
        if (!match || match.status === 'ended') continue
        sendMetaDirect(connection, { t: 'match-announce', gid: g, ...match })
      }
      prunePresence()
      for (const info of state.presence.values()) {
        if (!info || !info.address) continue
        sendMetaDirect(connection, {
          t: 'presence',
          address: info.address,
          nick: info.nick || null,
          status: info.status || 'idle',
          matchGid: info.matchGid || null,
          clientId: info.clientId || null
        })
      }
    } catch {}
  }

  function sendLocalMetaSnapshot (ws) {
    try {
      pruneMatches()
      prunePresence()
      for (const [g, match] of state.matches.entries()) {
        if (!match || match.status === 'ended') continue
        wsSend(ws, JSON.stringify({ t: 'match-announce', gid: g, ...match }))
      }
      for (const info of state.presence.values()) {
        if (!info || !info.address) continue
        wsSend(ws, JSON.stringify({
          t: 'presence',
          address: info.address,
          nick: info.nick || null,
          status: info.status || 'idle',
          matchGid: info.matchGid || null,
          clientId: info.clientId || null
        }))
      }
    } catch {}
  }

  function sendServerPresence (connection) {
    try {
      const pres = globalThis.__lastServerPresenceEnv
      if (!(pres instanceof Uint8Array)) return
      const gid = state.lastGid || (state.games.size === 1 ? state.games.values().next().value : null)
      if (gid) ensureGameChannel(connection, gid).message.send(pres)
    } catch {}
  }

  // Attach for existing connections and future ones
  if (peer.swarm) {
    for (const conn of peer.swarm.connections) {
      ensureMetaChannel(conn)
      sendMetaSnapshot(conn)
    }
    peer.swarm.on('connection', (connection) => {
      ensureMetaChannel(connection)
      sendMetaSnapshot(connection)
    })
  }

  function broadcastMetaHello (uid, address, nick, gid) {
    const msg = { t: 'hello', uid: uid >>> 0, address, nick: nick || null, gid }
    sendMetaToPeers(msg, null)
  }

  function normalizeMode (mode) {
    return (mode === 'altdeath' || mode === 'coop') ? mode : 'deathmatch'
  }

  function applyMatchUpdate (msg) {
    if (!msg || !msg.gid) return
    const gid = String(msg.gid)
    if (msg.t === 'match-end') {
      state.matches.delete(gid)
      return
    }
    const prev = state.matches.get(gid) || {}
    const next = { ...prev, ...msg, lastSeenMs: Date.now() }
    delete next.t
    if (!next.matchTopic) {
      next.matchTopic = normalizeMatchTopicHex(gid, prev.matchTopic || msg.matchTopic)
    }
    state.matches.set(gid, next)
  }

  function pruneMatches () {
    const now = Date.now()
    for (const [gid, info] of state.matches.entries()) {
      if (!info || !info.lastSeenMs) continue
      if ((now - info.lastSeenMs) > matchTtlMs) {
        state.matches.delete(gid)
      }
    }
  }

  function sendMetaToLocalClients (msg) {
    const payload = JSON.stringify(msg)
    for (const cli of state.clients) {
      if (cli.kind !== 'meta') continue
      try { wsSend(cli.ws, payload) } catch {}
    }
  }

  function broadcastMetaMessage (msg) {
    sendMetaToPeers(msg, null)
  }

  function broadcastMetaMode (gid, mode, noMonsters) {
    if (!gid) return
    const g = String(gid)
    const m = normalizeMode(mode)
    const nm = !!noMonsters
    state.gameInfo.set(g, { mode: m, noMonsters: nm })
    const msg = { t: 'mode', gid: g, mode: m, noMonsters: nm }
    sendMetaToLocalClients(msg)
    sendMetaToPeers(msg, null)
  }

  function wsSend (ws, data) {
    try {
      if (typeof ws.send === 'function') { ws.send(data); return true }
      if (typeof ws.write === 'function') {
        const buf = (typeof data === 'string' || Buffer.isBuffer(data)) ? data : Buffer.from(data)
        ws.write(buf)
        return true
      }
    } catch {}
    return false
  }

  function handleClientMessage (cli, data, isBinary) {
    if (isBinary) {
      // Binary frames are game payloads: [to(4)|from(4)|payload]
      try {
        const u8 = new Uint8Array(data)
        if (u8.byteLength >= 8) {
          const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength)
          const to = dv.getUint32(0, true)
          const from = dv.getUint32(4, true)
          if (cli.selfUid == null) cli.selfUid = from >>> 0

          // First, try local WS delivery (WS<->WS on same peer) to avoid unnecessary P2P forwarding
          let deliveredLocal = 0
          try {
            for (const c of state.clients) {
              if (c === cli) continue
              if (c.kind !== 'doom') continue
              if (to !== 0) {
                if (c.selfUid == null) continue
                if ((c.selfUid >>> 0) !== to) continue
              }
              const out = new Uint8Array(u8.byteLength - 4) // [from|payload]
              new DataView(out.buffer).setUint32(0, from >>> 0, true)
              out.set(u8.subarray(8), 4)
              try { if (wsSend(c.ws, out)) deliveredLocal++ } catch {}
            }
            if (deliveredLocal) {
              log('debug', `[ws-bridge] ws->ws delivered to=${to} from=${from} count=${deliveredLocal}`)
              return // do not forward to P2P when delivered locally
            }
          } catch {}
          // forward as-is onto swarm scoped by gid
          // choose gid: prefer cli-bound gid, else last seen gid, else only gid if unique
          let gid = cli.game.id
          if (!gid) gid = state.lastGid
          if (!gid && state.games.size === 1) gid = state.games.values().next().value
          if (gid) {
            if (!state.matchSwarm) {
              const known = state.matches.get(gid)
              ensureMatchSwarm(gid, known?.matchTopic || null)
            }
            ensureGid(gid)
            const conns = gameConnections()
            void ensureJoinGame(gid, from >>> 0)
            const seqKey = `${gid}:${from >>> 0}`
            const nextSeq = (state.seqOut.get(seqKey) || 0) + 1
            state.seqOut.set(seqKey, nextSeq)
            const sig = signEnvelope(gid, from >>> 0, nextSeq, u8)
            if (!sig || sig.length !== SIG_BYTES) {
              state.stats.gameDrop++
              return
            }
            const envBuf = encodeEnvelope(gid, from >>> 0, nextSeq, u8, sig)
            if (!conns.length && from !== 1) {
              queueGameFrame(gid, envBuf, to, from)
              try { log('debug', `[ws-bridge] queued frame gid=${gid} to=${to} from=${from} pending`) } catch {}
              return
            }
            let sent = 0
            if (to !== 0) {
              const dest = selectRoute(to, null)
              if (dest) {
                ensureGameChannel(dest, gid).message.send(envBuf)
                sent = 1
              } else {
                for (const conn of conns) { ensureGameChannel(conn, gid).message.send(envBuf); sent++ }
              }
            } else {
              for (const conn of conns) { ensureGameChannel(conn, gid).message.send(envBuf); sent++ }
            }
            // Only use default channel during bootstrap (no match swarm yet)
            if (!state.matchSwarm) {
              for (const conn of conns) { ensureDefaultChannel(conn).message.send(envBuf) }
            }
            try { log('debug', `[ws-bridge] ws->p2p gid=${gid} to=${to} from=${from} conns=${sent}`) } catch {}
            if (to === 0 && from === 1) {
              try { globalThis.__lastServerPresenceRaw = u8.slice() } catch {}
              try { globalThis.__lastServerPresenceEnv = envBuf.slice() } catch {}
            }
            state.stats.gameTx += sent
          } else {
            // bootstrap path before gid is known
            try { log('debug', `[ws-bridge] drop frame without gid to=${to} from=${from}`) } catch {}
          }
        }
      } catch {}
      return
    }
    // JSON control
    let msg
    try { msg = JSON.parse(String(data)) } catch { return }
    if (!msg || typeof msg.t !== 'string') return
    if (msg.t === 'hello') {
      cli.isServer = !!msg.isServer
      cli.selfUid = cli.isServer ? 1 : (typeof msg.uid === 'number' ? msg.uid >>> 0 : null)
      // If this meta client reports server role, seed the doom ws client uid to 1 for early delivery
      if (cli.isServer) {
        for (const c of state.clients) {
          if (c.kind === 'doom' && (c.selfUid == null)) c.selfUid = 1
        }
      }
      return
    }
    if (msg.t === 'gid') {
      const nextGid = String(msg.gid || '')
      if (nextGid && nextGid !== cli.game.id) cli.game.seq = 0
      cli.game.id = nextGid
      // Rebroadcast gid via meta hello to inform other peers quickly
      try { broadcastMetaHello(cli.selfUid || 0, state.meta.map.get(cli.selfUid||0)?.address || '', state.meta.map.get(cli.selfUid||0)?.nick || null, cli.game.id) } catch {}
      state.lastGid = cli.game.id
      ensureGid(cli.game.id)
      if (cli.game.id && !state.matchSwarm) {
        const known = state.matches.get(cli.game.id)
        ensureMatchSwarm(cli.game.id, known?.matchTopic || null)
      }
      return
    }
    if (msg.t === 'mhello') {
      if (typeof msg.uid === 'number' && typeof msg.address === 'string') {
        state.meta.map.set(msg.uid >>> 0, { address: msg.address, nick: msg.nick || null })
        broadcastMetaHello(msg.uid >>> 0, msg.address, msg.nick || null, cli.game.id)
      }
      return
    }
    if (msg.t === 'mode') {
      if (!cli.game.id && msg.gid) cli.game.id = String(msg.gid)
      const gid = cli.game.id || (msg.gid ? String(msg.gid) : null)
      broadcastMetaMode(gid, msg.mode, msg.noMonsters)
      return
    }
    if (msg.t === 'presence') {
      ensureMetaRid(msg)
      upsertPresence(msg)
      broadcastMetaMessage(msg)
      return
    }
    if (msg.t === 'match-list-req') {
      if (cli.kind === 'meta') {
        sendLocalMetaSnapshot(cli.ws)
      }
      ensureMetaRid(msg)
      broadcastMetaMessage(msg)
      return
    }
    if (msg.t === 'match-announce' || msg.t === 'match-update' || msg.t === 'match-start' || msg.t === 'match-end') {
      if (msg.gid) {
        const gid = String(msg.gid)
        if (!msg.matchTopic) {
          const known = state.matches.get(gid)
          msg.matchTopic = normalizeMatchTopicHex(gid, known?.matchTopic || msg.matchTopic)
        }
        if (msg.t === 'match-announce' && msg.host && msg.host === peer?.wallet?.publicKey) {
          ensureMatchSwarm(gid, msg.matchTopic)
        }
        if (msg.t === 'match-end' && state.matchGid === gid) {
          destroyMatchSwarm('match-end')
        }
      }
      ensureMetaRid(msg)
      applyMatchUpdate(msg)
      broadcastMetaMessage(msg)
      return
    }
    if (msg.t === 'match-join' || msg.t === 'match-accept' || msg.t === 'match-deny' || msg.t === 'match-leave') {
      if (msg.gid) {
        const gid = String(msg.gid)
        if (!msg.matchTopic) {
          const known = state.matches.get(gid)
          msg.matchTopic = normalizeMatchTopicHex(gid, known?.matchTopic || msg.matchTopic)
        }
        if (msg.t === 'match-join' && msg.from && peer?.wallet?.publicKey && msg.from === peer.wallet.publicKey) {
          ensureMatchSwarm(gid, msg.matchTopic)
        }
      }
      ensureMetaRid(msg)
      broadcastMetaMessage(msg)
      return
    }
    if (msg.t === 'chat') {
      ensureMetaRid(msg)
      broadcastMetaMessage(msg)
      return
    }
    if (msg.t === 'klog') {
      if (!cli.isServer && cli.selfUid !== 1) return
      const gid = cli.game.id || state.matchGid || state.lastGid || (state.games.size === 1 ? state.games.values().next().value : null)
      if (!gid) return
      if (!cli.game.id) cli.game.id = gid
      void isGameReady(gid).then((ok) => {
        if (!ok) return
        try {
          const info = state.gameInfo.get(gid)
          if (info && info.mode === 'coop') return
          const killer = state.meta.map.get((msg.killerUid >>> 0))?.address
          const victim = state.meta.map.get((msg.victimUid >>> 0))?.address
          if (!killer || !victim) return
          cli.game.seq = (cli.game.seq | 0) + 1
          peer.protocol_instance.api.recordKillStrict(gid, cli.game.seq, killer, victim).catch(()=>{})
        } catch {}
      })
      return
    }
  }

  function onConnection (ws, kind) {
    const cli = { ws, kind, isServer: false, selfUid: null, game: { id: null, seq: 0 }, local: { address: null, nick: null } }
    state.clients.add(cli)
    try { log('info', `[ws-bridge] ws connected kind=${kind}, clients=${state.clients.size}`) } catch {}
    // If this is a doom client and we have a cached server presence broadcast, nudge it immediately
    if (kind === 'doom' && globalThis.__lastServerPresenceRaw instanceof Uint8Array) {
      try {
        const pres = globalThis.__lastServerPresenceRaw
        const dv = new DataView(pres.buffer, pres.byteOffset, pres.byteLength)
        const from = dv.getUint32(4, true)
        const payload = pres.subarray(8)
        const out = new Uint8Array(4 + payload.byteLength)
        new DataView(out.buffer).setUint32(0, from >>> 0, true)
        out.set(payload, 4)
        wsSend(ws, out)
        log('info', '[ws-bridge] rebroadcasted cached server presence to new doom client')
      } catch {}
    }
    if (typeof ws.on === 'function') {
      if (typeof ws.send === 'function') {
        ws.on('message', (data, isBinary) => handleClientMessage(cli, data, isBinary))
      } else {
        ws.on('data', (data) => {
          let isBinary = true
          let payload = data
          try {
            const str = Buffer.isBuffer(data) ? data.toString('utf8') : String(data)
            const msg = JSON.parse(str)
            if (msg && typeof msg.t === 'string') {
              isBinary = false
              payload = str
            }
          } catch {}
          handleClientMessage(cli, payload, isBinary)
        })
      }
      const onClose = () => { state.clients.delete(cli) }
      ws.on('close', onClose)
      ws.on('end', onClose)
    }
    if (kind === 'meta' && state.gameInfo.size > 0) {
      for (const [gid, info] of state.gameInfo.entries()) {
        try { wsSend(ws, JSON.stringify({ t: 'mode', gid, mode: info.mode, noMonsters: info.noMonsters })) } catch {}
      }
    }
    if (kind === 'meta') {
      sendLocalMetaSnapshot(ws)
    }
  }

  if (!disableWS) {
    if (!useBare) {
      doomWSS.on('connection', (ws) => onConnection(ws, 'doom'))
      metaWSS.on('connection', (ws) => onConnection(ws, 'meta'))
    }
  }

  if (!disableWS) {
    httpServer.on('upgrade', (req, socket, head) => {
      const url = req.url || '/'
      if (!useBare) {
        if (url.startsWith('/doom')) {
          doomWSS.handleUpgrade(req, socket, head, (ws) => doomWSS.emit('connection', ws, req))
        } else if (url.startsWith('/meta')) {
          metaWSS.handleUpgrade(req, socket, head, (ws) => metaWSS.emit('connection', ws, req))
        } else {
          socket.write('HTTP/1.1 404 Not Found\r\n\r\n')
          socket.destroy()
        }
        return
      }
      if (!BareWebSocket || !WebSocketServer?.handshake) {
        socket.write('HTTP/1.1 500 WS Unavailable\r\n\r\n')
        socket.destroy()
        return
      }
      if (url.startsWith('/doom') || url.startsWith('/meta')) {
        WebSocketServer.handshake(req, socket, head, (err) => {
          if (err) { try { socket.destroy() } catch {} return }
          const ws = new BareWebSocket({ socket, isServer: true })
          onConnection(ws, url.startsWith('/doom') ? 'doom' : 'meta')
        })
      } else {
        socket.write('HTTP/1.1 404 Not Found\r\n\r\n')
        socket.destroy()
      }
    })
  }

  if (!disableWS) {
    httpServer.on('error', (e) => {
      log('error', '[ws-bridge] error:', e?.message || e)
    })

    // Auto-bind with EADDRINUSE retry; update peer._dnetPort when bound
    let curPort = port
    let attempts = 0
    httpServer.on('listening', () => {
      try {
        const addr = httpServer.address()
        const bound = (addr && typeof addr === 'object') ? addr.port : curPort
        peer._dnetPort = bound
        log('info', `[ws-bridge] Doom WS server listening on ws://${host}:${bound}/doom and /meta, swarm_conns=${peer?.swarm?.connections?.length || 0}`)
      } catch {}
    })
    httpServer.on('error', (e) => {
      if (e && e.code === 'EADDRINUSE' && attempts < 10) {
        attempts++
        curPort++
        log('warn', `[ws-bridge] port in use, retrying on ${curPort}`)
        setTimeout(() => { try { httpServer.listen(curPort, host) } catch {} }, 50)
        return
      }
      log('error', '[ws-bridge] error:', e?.message || e)
    })
    try { httpServer.listen(curPort, host) } catch {}

    // Periodic WS ping to keep browser clients alive during inactivity
    const pingInterval = setInterval(() => {
      try {
        for (const cli of state.clients) {
          if (cli.kind !== 'doom') continue
          const s = cli.ws
          if (s && typeof s.ping === 'function') {
            const isOpen = (typeof s.readyState === 'number') ? s.readyState === 1 : !s.destroyed
            if (!isOpen) continue
            try { s.ping() } catch {}
          }
        }
      } catch {}
    }, 10000)
    httpServer.on('close', () => { try { clearInterval(pingInterval) } catch {} })
  }

  // Expose lightweight info for RPC
  peer._wsInfo = function () {
    let doom = 0, meta = 0
    for (const c of state.clients) { if (c.kind === 'doom') doom++; else if (c.kind === 'meta') meta++ }
    return {
      doomClients: doom,
      metaClients: meta,
      games: Array.from(state.games),
      lastGid: state.lastGid,
      matchGid: state.matchGid,
      matchConns: matchConnectionCount(),
      stats: { ...state.stats }
    }
  }
  return httpServer || null
}

import React from 'react'
import { createRoot } from 'react-dom/client'
import { html } from 'htm/react'
import fs from 'fs'
import http from 'http'
import path from 'path'
import { resolveWadConfig, readWadFiles, parseWarpInput, mapPlaceholder, listWadFiles, hashWadBuffer, hashWadFile, parsePwads, getWadTypeFromBuffer, listWadMapNames } from './src/ui/wad.js'

const env = (typeof process !== 'undefined' && process.env) ? process.env : {}
const rpcPort = env.TRAC_RPC_PORT ? parseInt(env.TRAC_RPC_PORT) : 7767
const dnetPortEnv = env.TRAC_DNET_PORT ? parseInt(env.TRAC_DNET_PORT) : 7788
const rpcWaitMsRaw = env.TRAC_RPC_WAIT_MS ? parseInt(env.TRAC_RPC_WAIT_MS) : 600000
const rpcWaitMs = Number.isFinite(rpcWaitMsRaw) ? rpcWaitMsRaw : 600000
const rpcWaitForever = env.TRAC_RPC_WAIT_FOREVER === '1' || rpcWaitMs <= 0
const presenceTtlMs = env.TRAC_PRESENCE_TTL_MS ? parseInt(env.TRAC_PRESENCE_TTL_MS) : 8000
const matchTtlMs = env.TRAC_MATCH_TTL_MS ? parseInt(env.TRAC_MATCH_TTL_MS) : 15000
const matchSwarmWaitMsRaw = env.TRAC_MATCH_SWARM_WAIT_MS ? parseInt(env.TRAC_MATCH_SWARM_WAIT_MS) : 120000
const matchSwarmWaitMs = Number.isFinite(matchSwarmWaitMsRaw) ? matchSwarmWaitMsRaw : 120000
const pendingJoinTimeoutMsRaw = env.TRAC_PENDING_JOIN_TIMEOUT_MS ? parseInt(env.TRAC_PENDING_JOIN_TIMEOUT_MS) : 120000
const pendingJoinTimeoutMs = Number.isFinite(pendingJoinTimeoutMsRaw) ? pendingJoinTimeoutMsRaw : 120000
const soundEnabled = !(env.TRAC_SOUND === '0' || env.TRAC_SOUND === 'false')
const musicEnabled = env.TRAC_MUSIC === '1' || env.TRAC_MUSIC === 'true'
const noSound = env.TRAC_NO_SOUND === '1' || env.TRAC_NO_SOUND === 'true' || !soundEnabled
const noMusic = env.TRAC_NO_MUSIC === '1' || env.TRAC_NO_MUSIC === 'true' || !musicEnabled
const audioSampleRateRaw = env.TRAC_AUDIO_SAMPLE_RATE ? parseInt(env.TRAC_AUDIO_SAMPLE_RATE, 10) : null
const audioSampleRate = Number.isFinite(audioSampleRateRaw) ? audioSampleRateRaw : 44100
const audioSampleRateFromEnv = Number.isFinite(audioSampleRateRaw)
const audioSliceMsRaw = env.TRAC_AUDIO_SLICE_MS ? parseInt(env.TRAC_AUDIO_SLICE_MS, 10) : null
const audioSliceMs = Number.isFinite(audioSliceMsRaw) ? audioSliceMsRaw : 100
const audioSliceMsFromEnv = Number.isFinite(audioSliceMsRaw)
const audioChannelsRaw = env.TRAC_AUDIO_CHANNELS ? parseInt(env.TRAC_AUDIO_CHANNELS, 10) : null
const audioChannels = Number.isFinite(audioChannelsRaw) ? Math.max(1, Math.min(8, audioChannelsRaw)) : 8
const audioChannelsFromEnv = Number.isFinite(audioChannelsRaw)
const audioWaitMsRaw = env.TRAC_AUDIO_WAIT_MS ? parseInt(env.TRAC_AUDIO_WAIT_MS) : 5000
const audioWaitMs = Number.isFinite(audioWaitMsRaw) ? audioWaitMsRaw : 5000
const audioPreflightMsRaw = env.TRAC_AUDIO_PREFLIGHT_MS ? parseInt(env.TRAC_AUDIO_PREFLIGHT_MS) : 400
const audioPreflightMs = Number.isFinite(audioPreflightMsRaw) ? audioPreflightMsRaw : 400
const audioStrict = env.TRAC_AUDIO_STRICT === '1' || env.TRAC_AUDIO_STRICT === 'true'
const chatLimitMaxRaw = env.TRAC_CHAT_LIMIT_MAX ? parseInt(env.TRAC_CHAT_LIMIT_MAX, 10) : null
const chatLimitMax = Number.isFinite(chatLimitMaxRaw) ? Math.max(20, Math.min(1000, chatLimitMaxRaw)) : 200
const scoreTopLimitRaw = env.TRAC_SCORE_TOP ? parseInt(env.TRAC_SCORE_TOP, 10) : null
const scoreTopLimit = Number.isFinite(scoreTopLimitRaw) ? Math.max(5, Math.min(200, scoreTopLimitRaw)) : 20
const nickSaveDelayMsRaw = env.TRAC_NICK_SAVE_DELAY_MS ? parseInt(env.TRAC_NICK_SAVE_DELAY_MS, 10) : null
const nickSaveDelayMs = Number.isFinite(nickSaveDelayMsRaw) ? Math.max(300, Math.min(5000, nickSaveDelayMsRaw)) : 1500
const wadScanMsRaw = env.TRAC_WAD_SCAN_MS ? parseInt(env.TRAC_WAD_SCAN_MS, 10) : null
const wadScanMs = Number.isFinite(wadScanMsRaw) ? Math.max(2000, Math.min(60000, wadScanMsRaw)) : 10000
const MAP_CACHE_KEY = 'trac_map_cache_v2'
const MAP_CACHE_LIMIT = 10
const MIN_PLAYERS = 1
const MAX_PLAYERS = 4
const DEFAULT_PLAYERS = 4
const MIN_SKILL = 1
const MAX_SKILL = 5
const DEFAULT_SKILL = 3
const SKILL_OPTIONS = [
  { value: 1, label: "I'm too young to die" },
  { value: 2, label: 'Hey, not too rough' },
  { value: 3, label: 'Hurt me plenty' },
  { value: 4, label: 'Ultra-Violence' },
  { value: 5, label: 'Nightmare!' }
]
const BUNDLED_IWADS = [
  { name: 'doom1.wad', key: 'bundled:doom1.wad', label: 'Bundled doom1.wad (Freedoom1)' },
  { name: 'doom2.wad', key: 'bundled:doom2.wad', label: 'Bundled doom2.wad (Freedoom2)' }
]
const DEFAULT_BUNDLED_IWAD = BUNDLED_IWADS[0]
const DEFAULT_BUNDLED_IWAD_KEY = DEFAULT_BUNDLED_IWAD.key
const BUNDLED_IWAD_KEYS = new Set(BUNDLED_IWADS.map((iwad) => iwad.key))
const BUNDLED_IWAD_NAMES = new Set(BUNDLED_IWADS.map((iwad) => iwad.name))
const doomUseBlob = env.TRAC_DOOM_USE_BLOB === '1' || env.TRAC_DOOM_USE_BLOB === 'true'
const defaultCfgFallback = `use_libsamplerate             0
force_software_renderer       0
startup_delay                 2000
show_diskicon                 1
crispy_soundfix               1
grabmouse                     0
fullscreen                    0
sfx_volume                    8
music_volume                  8
show_messages                 1
key_right                     25
key_left                      24
key_up                        17
key_down                      31
key_strafeleft                30
key_straferight               32
key_fire                      57
key_use                       18
key_strafe                    46
key_speed                     42
key_strafe_alt                46
key_speed_alt                 42
key_fullscreen                33
use_mouse                     1
use_joystick                  0
screenblocks                  10
detaillevel                   0
snd_channels                  8
snd_samplerate                44100
snd_maxslicetime_ms           100
snd_musicdevice               3
snd_sfxdevice                 3
snd_sbport                    0
snd_sbirq                     0
snd_sbdma                     0
snd_mport                     0
usegamma                      0
chatmacro0                    "No"
chatmacro1                    "I'm ready to kick butt!"
chatmacro2                    "I'm OK."
chatmacro3                    "I'm not looking too good!"
chatmacro4                    "Help!"
chatmacro5                    "You suck!"
chatmacro6                    "Next time, scumbag..."
chatmacro7                    "Come here!"
chatmacro8                    "I'll take care of it."
chatmacro9                    "Yes"
`
const runtimeCwd = (typeof process !== 'undefined' && typeof process.cwd === 'function')
  ? process.cwd()
  : ((env && env.PWD) ? env.PWD : '')
const runtimeRoot = (typeof globalThis !== 'undefined' && globalThis.Pear && globalThis.Pear.app && globalThis.Pear.app.dir)
  ? globalThis.Pear.app.dir
  : runtimeCwd
const decodeUtf8 = (buf) => (typeof Buffer !== 'undefined')
  ? Buffer.from(buf).toString('utf8')
  : new TextDecoder('utf-8').decode(buf)
const encodeUtf8 = (str) => (typeof Buffer !== 'undefined')
  ? Buffer.from(str, 'utf8')
  : new TextEncoder().encode(str)
const isProbablyUrl = (value) => typeof value === 'string' && /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)
const resolveAssetUrl = (relPath) => {
  if (!relPath || isProbablyUrl(relPath)) return relPath
  try {
    const base = (typeof document !== 'undefined' && document.baseURI)
      ? document.baseURI
      : ((typeof window !== 'undefined' && window.location && window.location.href) ? window.location.href : '')
    if (base) return new URL(relPath, base).toString()
  } catch {}
  return relPath
}
function randomId () {
  return Math.random().toString(16).slice(2) + Date.now().toString(16)
}

const hasNodeHttp = typeof http?.request === 'function'
const rpcBase = `http://127.0.0.1:${rpcPort}`
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
let nodeWebSocketCtor = null

async function ensureNodeWebSocket () {
  if (nodeWebSocketCtor) return nodeWebSocketCtor
  try {
    const m = await import('ws')
    nodeWebSocketCtor = m.WebSocket || (m.default && (m.default.WebSocket || m.default)) || m
  } catch {}
  return nodeWebSocketCtor
}

function nodeRequestJson (url, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const req = http.request({
      hostname: u.hostname,
      port: u.port || 80,
      path: u.pathname + u.search,
      method: opts.method || 'GET',
      headers: opts.headers
    }, (res) => {
      let data = ''
      res.setEncoding('utf8')
      res.on('data', (c) => { data += c })
      res.on('end', () => {
        try { resolve(JSON.parse(data || '{}')) } catch (e) { reject(e) }
      })
    })
    req.on('error', reject)
    if (opts.body) req.write(opts.body)
    req.end()
  })
}

async function requestJson (url, opts) {
  if (hasNodeHttp) return nodeRequestJson(url, opts)
  const r = await fetch(url, opts)
  return r.json()
}

async function waitForRpcInfo () {
  const start = Date.now()
  let attempt = 0
  while (true) {
    try {
      return await RPC.get('/info')
    } catch (err) {
      attempt += 1
      if (!rpcWaitForever && Date.now() - start >= rpcWaitMs) {
        const e = new Error(`RPC not ready at ${rpcBase} after ${attempt} attempts`)
        e.cause = err
        throw e
      }
      if (attempt % 10 === 0) {
        console.log(`[app] waiting for RPC at ${rpcBase} (${attempt} attempts)`)
      }
      await sleep(Math.min(500, 100 + attempt * 50))
    }
  }
}

async function waitForMatchSwarmReady (gid, opts = {}) {
  const timeoutMs = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : matchSwarmWaitMs
  const intervalMs = Number.isFinite(opts.intervalMs) ? opts.intervalMs : 300
  const start = Date.now()
  while (true) {
    try {
      const info = await RPC.get('/ws/info')
      const conns = (info && typeof info.matchConns === 'number') ? info.matchConns : 0
      const activeGid = info && info.matchGid ? String(info.matchGid) : null
      if (conns > 0 && (!gid || !activeGid || activeGid == gid)) return true
    } catch {}
    if (timeoutMs >= 0 && Date.now() - start >= timeoutMs) return false
    await sleep(intervalMs)
  }
}

const RPC = {
  async get (path) {
    return requestJson(`${rpcBase}${path}`)
  },
  async post (path, body) {
    return requestJson(`${rpcBase}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })
  }
}

const peer = {
  async ready () { return },
  wallet: { publicKey: '' },
  options: { channel: '' },
  connectedPeers: new Set(),
  async init () {
    const info = await waitForRpcInfo()
    this.wallet.publicKey = info.publicKey
    this.options.channel = info.channel
    this.connectedPeers = new Set(info.peers || [])
    this.dnetPort = (typeof info.dnetPort === 'number') ? info.dnetPort : dnetPortEnv
    setInterval(async () => {
      try {
        const i = await RPC.get('/info')
        this.connectedPeers = new Set((i && i.peers) || [])
        if (i && typeof i.dnetPort === 'number') this.dnetPort = i.dnetPort
      } catch {}
    }, 1000)
  },
  protocol_instance: { api: {
    getNick: async (addr) => { const r = await RPC.get('/nick?addr=' + encodeURIComponent(addr)); return r.nick || null },
    startGame: (gid, mode) => RPC.post('/startGame', { gid, mode }),
    endGame: (gid) => RPC.post('/endGame', { gid }),
    recordKillStrict: (gid, seq, killer, victim) => RPC.post('/recordKillStrict', { gid, seq, killer, victim })
  } },
  base: { view: { get: async (key) => { const r = await RPC.get('/view?key=' + encodeURIComponent(key)); return r.value ?? null } } }
}

function loadDoomScript (jsPath, onReady, onFail, opts = {}) {
  const s = document.createElement('script')
  s.type = 'text/javascript'
  const savedProcess = window.process
  const cwd = runtimeRoot
  const cacheBust = !!opts.cacheBust
  const onUrl = typeof opts.onUrl === 'function' ? opts.onUrl : null
  try {
    window.process = undefined
  } catch (e) {
    try { Object.defineProperty(window, 'process', { value: undefined, configurable: true, writable: true }) } catch {}
  }
  const finalize = (ok, err) => {
    try { window.process = savedProcess } catch {}
    if (s.dataset && s.dataset.blobUrl) {
      try { URL.revokeObjectURL(s.dataset.blobUrl) } catch {}
    }
    if (ok) onReady()
    else onFail(err)
  }
  s.onload = () => finalize(true)
  s.onerror = (e) => finalize(false, e)

  let useBlob = false
  let scriptUrl = jsPath
  if (doomUseBlob) {
    try {
      if (fs && fs.readFileSync) {
        const abs = path.isAbsolute(jsPath) ? jsPath : (cwd ? path.join(cwd, jsPath) : jsPath)
        const code = fs.readFileSync(abs, 'utf8')
        const blob = new Blob([code], { type: 'text/javascript' })
        const url = URL.createObjectURL(blob)
        s.src = url
        s.dataset.blobUrl = url
        scriptUrl = url
        useBlob = true
      }
    } catch {
      useBlob = false
    }
  }
  if (!useBlob) {
    if (cacheBust && typeof jsPath === 'string' && !jsPath.startsWith('blob:')) {
      const sep = jsPath.includes('?') ? '&' : '?'
      scriptUrl = `${jsPath}${sep}v=${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`
    }
    s.src = scriptUrl
  }

  if (onUrl) {
    try { onUrl(scriptUrl) } catch {}
  }
  document.body.appendChild(s)
  return { el: s, url: scriptUrl, blob: useBlob }
}

function sanitizeNick (name) {
  if (typeof name !== 'string') return ''
  const trimmed = name.trim()
  if (!trimmed) return ''
  return trimmed.replace(/[\\\"\r\n]/g, '').slice(0, 32)
}

function sanitizeFilename (name) {
  if (typeof name !== 'string') return ''
  let out = name.trim()
  if (!out) return ''
  out = out.replace(/[\\\/]/g, '')
  out = out.replace(/[\r\n]/g, '')
  out = out.replace(/[^\x20-\x7E]/g, '')
  out = out.replace(/[^A-Za-z0-9._-]+/g, '')
  if (!out) return ''
  return out.slice(0, 64)
}

function normalizeWadDir (value) {
  if (typeof value !== 'string') return ''
  let out = value.trim()
  if (!out) return ''
  if ((out.startsWith('"') && out.endsWith('"')) || (out.startsWith("'") && out.endsWith("'"))) {
    out = out.slice(1, -1).trim()
  }
  if (out.startsWith('~')) {
    const home = env.HOME || env.USERPROFILE || ''
    if (home) {
      const rest = out.slice(1).replace(/^[\\/]+/, '')
      out = path.join(home, rest)
    }
  }
  return out
}

function isBundledIwadKey (key) {
  return typeof key === 'string' && BUNDLED_IWAD_KEYS.has(key)
}

function isBundledIwadName (name) {
  return typeof name === 'string' && BUNDLED_IWAD_NAMES.has(name)
}

function getBundledIwadEntry (key) {
  if (!key) return null
  return BUNDLED_IWADS.find((iwad) => iwad.key === key) || null
}

function getBundledKeyForName (name) {
  if (!name) return null
  const entry = BUNDLED_IWADS.find((iwad) => iwad.name === name)
  return entry ? entry.key : null
}

function sanitizeChat (text) {
  if (typeof text !== 'string') return ''
  let out = text.replace(/[\r\n]+/g, ' ').trim()
  if (!out) return ''
  out = out.replace(/[^\x20-\x7E]/g, '')
  if (!out) return ''
  if (out.length > 200) out = out.slice(0, 200)
  return out
}

function normalizeGameMode (mode) {
  if (mode === 'altdeath' || mode === 'coop') return mode
  return 'deathmatch'
}

function clampPlayers (value, fallback = DEFAULT_PLAYERS) {
  if (!Number.isFinite(value)) return fallback
  return Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, value))
}

function clampSkill (value, fallback = DEFAULT_SKILL) {
  if (!Number.isFinite(value)) return fallback
  return Math.max(MIN_SKILL, Math.min(MAX_SKILL, value))
}

function skillLabel (value) {
  const skill = clampSkill(parseInt(value, 10), DEFAULT_SKILL)
  const entry = SKILL_OPTIONS.find((opt) => opt.value === skill)
  return entry ? entry.label : `Skill ${skill}`
}

function isTransientWadError (msg) {
  if (!msg) return false
  return (
    msg.includes('Scanning WAD folder') ||
    msg.includes('Select a WAD folder') ||
    msg.includes('Selected IWAD not found in folder') ||
    msg.includes('Selected PWAD not found in folder') ||
    msg.includes('Selected IWAD is not an IWAD') ||
    msg.includes('Selected PWAD is not a PWAD')
  )
}

function readMapCache () {
  try {
    if (typeof localStorage === 'undefined') return { order: [], data: {} }
    const raw = localStorage.getItem(MAP_CACHE_KEY)
    if (!raw) return { order: [], data: {} }
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return { order: [], data: {} }
    const order = Array.isArray(parsed.order) ? parsed.order.filter((k) => typeof k === 'string') : []
    const data = (parsed.data && typeof parsed.data === 'object') ? parsed.data : {}
    return { order, data }
  } catch {
    return { order: [], data: {} }
  }
}

function writeMapCache (cache) {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(MAP_CACHE_KEY, JSON.stringify(cache))
  } catch {}
}

function mapCacheKey (wadData) {
  if (!wadData) return ''
  const i = wadData.iwadHash || ''
  const p = Array.isArray(wadData.pwadHashes) ? wadData.pwadHashes.join(',') : ''
  return `${i}|${p}`
}

function sortMapNames (maps) {
  const uniq = new Set()
  for (const name of maps || []) {
    if (!name) continue
    uniq.add(String(name).toUpperCase())
  }
  const list = Array.from(uniq)
  const parse = (name) => {
    if (/^E\\dM\\d$/.test(name)) return { type: 0, a: parseInt(name[1], 10), b: parseInt(name[3], 10) }
    if (/^MAP\\d\\d$/.test(name)) return { type: 1, a: parseInt(name.slice(3), 10), b: 0 }
    return { type: 2, a: 0, b: 0 }
  }
  list.sort((a, b) => {
    const pa = parse(a)
    const pb = parse(b)
    if (pa.type !== pb.type) return pa.type - pb.type
    if (pa.a !== pb.a) return pa.a - pb.a
    if (pa.b !== pb.b) return pa.b - pb.b
    return a.localeCompare(b)
  })
  return list
}

function buildMapOptions (wadData) {
  const iwadMaps = wadData?.iwad?.buf ? listWadMapNames(wadData.iwad.buf) : new Set()
  const pwadMaps = new Set()
  for (const pw of wadData?.pwads || []) {
    if (!pw || !pw.buf) continue
    const names = listWadMapNames(pw.buf)
    for (const name of names) pwadMaps.add(name)
  }
  const values = sortMapNames(new Set([...iwadMaps, ...pwadMaps]))
  const options = values.map((name) => {
    const inIwad = iwadMaps.has(name)
    const inPwad = pwadMaps.has(name)
    let label = name
    let source = 'iwad'
    if (inPwad && inIwad) {
      label = `${name} (PWAD override)`
      source = 'pwad-override'
    } else if (inPwad) {
      label = `${name} (PWAD)`
      source = 'pwad'
    }
    return { value: name, label, source, key: name }
  })
  return { options, values }
}

function wsDataToString (data) {
  if (typeof data === 'string') return data
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(data)) return data.toString('utf8')
  if (data instanceof ArrayBuffer) return new TextDecoder('utf-8').decode(new Uint8Array(data))
  if (ArrayBuffer.isView(data)) return new TextDecoder('utf-8').decode(data)
  if (data && typeof data.data !== 'undefined') return wsDataToString(data.data)
  return ''
}

function escapeRegExp (value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function upsertCfgValue (text, key, value, options = {}) {
  if (!key) return text
  const strValue = String(value)
  const onlyIfMissing = !!options.onlyIfMissing
  const line = `${key} ${strValue}`
  const re = new RegExp(`^${escapeRegExp(key)}\\s+.*$`, 'm')
  if (re.test(text)) {
    if (onlyIfMissing) return text
    return text.replace(re, line)
  }
  return text.replace(/\s*$/, `\n${line}\n`)
}

function injectPlayerName (cfgBuf, name) {
  if (!name) return cfgBuf
  const isString = typeof cfgBuf === 'string'
  let text = isString ? cfgBuf : decodeUtf8(cfgBuf)
  const line = `player_name "${name}"`
  if (/^player_name\s+/m.test(text)) {
    text = text.replace(/^player_name\s+.*$/m, line)
  } else {
    text = text.replace(/\s*$/, `\n${line}\n`)
  }
  return isString ? text : encodeUtf8(text)
}

const UI_STATE_KEY = 'trac-doom-ui-state'
function readUiState () {
  try {
    if (typeof localStorage === 'undefined') return null
    const raw = localStorage.getItem(UI_STATE_KEY)
    if (!raw) return null
    const data = JSON.parse(raw)
    return (data && typeof data === 'object') ? data : null
  } catch {
    return null
  }
}

async function main () {
  await peer.init()

  // Simple lobby + wasm loader
  function DoomApp () {
    const persistedRef = React.useRef(null)
    if (persistedRef.current === null) persistedRef.current = readUiState() || {}
    const persisted = persistedRef.current || {}
    const initialChatLimitRaw = Number.isFinite(parseInt(persisted.chatLimit, 10)) ? parseInt(persisted.chatLimit, 10) : 40
    const initialChatLimit = Math.min(chatLimitMax, Math.max(10, initialChatLimitRaw))
    const initialScoreMode = (persisted.scoreMode === 'deathmatch' || persisted.scoreMode === 'altdeath')
      ? persisted.scoreMode
      : 'deathmatch'
    const initialGameMode = normalizeGameMode(persisted.gameMode || 'deathmatch')
    const initialMaxPlayersRaw = Number.isFinite(parseInt(persisted.maxPlayers, 10))
      ? parseInt(persisted.maxPlayers, 10)
      : (env.TRAC_PLAYERS ? parseInt(env.TRAC_PLAYERS) : DEFAULT_PLAYERS)
    const initialMaxPlayers = clampPlayers(initialMaxPlayersRaw, DEFAULT_PLAYERS)
    const initialMapInput = (typeof persisted.mapInput === 'string') ? persisted.mapInput : ''
    const initialSkillRaw = Number.isFinite(parseInt(persisted.skill, 10))
      ? parseInt(persisted.skill, 10)
      : (env.TRAC_SKILL ? parseInt(env.TRAC_SKILL, 10) : DEFAULT_SKILL)
    const initialSkill = clampSkill(initialSkillRaw, DEFAULT_SKILL)
    const initialNick = (typeof persisted.nick === 'string') ? persisted.nick : ''
    const envWadDirRaw = (typeof env.TRAC_WAD_DIR === 'string') ? env.TRAC_WAD_DIR : ''
    const envIwadRaw = (typeof env.TRAC_IWAD === 'string') ? env.TRAC_IWAD : ''
    const envPwadsRaw = parsePwads(env.TRAC_PWADS)
    let envWadDir = envWadDirRaw
    if (!envWadDir && envIwadRaw && path.isAbsolute(envIwadRaw)) {
      try { envWadDir = path.dirname(envIwadRaw) } catch {}
    }
    if (!envWadDir && envPwadsRaw && envPwadsRaw.length) {
      const first = envPwadsRaw[0]
      if (first && path.isAbsolute(first)) {
        try { envWadDir = path.dirname(first) } catch {}
      }
    }
    const initialWadDir = (typeof persisted.wadDir === 'string') ? persisted.wadDir : envWadDir
    const initialSelectedIwad = (typeof persisted.selectedIwad === 'string')
      ? persisted.selectedIwad
      : (envIwadRaw ? path.basename(envIwadRaw) : DEFAULT_BUNDLED_IWAD_KEY)
    const initialSelectedPwadsRaw = Array.isArray(persisted.selectedPwads)
      ? persisted.selectedPwads
      : (envPwadsRaw && envPwadsRaw.length ? envPwadsRaw.map((p) => path.basename(p)) : [])
    const initialSelectedPwads = initialSelectedPwadsRaw.filter((p) => !String(p || '').startsWith('bundled-pwad:'))

    const [stage, setStage] = React.useState('lobby') // lobby | running
    const [status, setStatus] = React.useState('')
    const [nick, setNick] = React.useState(initialNick)
    const [peers, setPeers] = React.useState([])
    const [peerNicks, setPeerNicks] = React.useState(new Map())
    const [scores, setScores] = React.useState([]) // [{ address, count, nick }]
    const [scoreLoading, setScoreLoading] = React.useState(false)
    const [achievements, setAchievements] = React.useState([]) // [{ id, title, count }]
    const [achLoading, setAchLoading] = React.useState(false)
    const [nickDirty, setNickDirty] = React.useState(false)
    const [nickSaving, setNickSaving] = React.useState(false)
    const [error, setError] = React.useState('')
    const [wadInfo, setWadInfo] = React.useState(null)
    const [wadError, setWadError] = React.useState('')
    const [wadDir, setWadDir] = React.useState(initialWadDir)
    const [wadDirInput, setWadDirInput] = React.useState(initialWadDir)
    const [wadFiles, setWadFiles] = React.useState([])
    const [wadScanError, setWadScanError] = React.useState('')
    const [selectedIwad, setSelectedIwad] = React.useState(initialSelectedIwad)
    const [selectedPwads, setSelectedPwads] = React.useState(initialSelectedPwads)
    const [mapInput, setMapInput] = React.useState(initialMapInput)
    const [skill, setSkill] = React.useState(initialSkill)
    const [maxPlayers, setMaxPlayers] = React.useState(initialMaxPlayers)
    const [matches, setMatches] = React.useState(new Map())
    const [presence, setPresence] = React.useState(new Map())
    const [pendingJoin, setPendingJoin] = React.useState(null)
    const [currentMatch, setCurrentMatch] = React.useState(null)
    const [gameMode, setGameMode] = React.useState(initialGameMode)
    const [noMonsters, setNoMonsters] = React.useState(!!persisted.noMonsters)
    const [hostMode, setHostMode] = React.useState(null)
    const [hostNoMonsters, setHostNoMonsters] = React.useState(false)
    const [scoreMode, setScoreMode] = React.useState(initialScoreMode)
    const [metaConnected, setMetaConnected] = React.useState(false)
    const [metaLastMsgAt, setMetaLastMsgAt] = React.useState(0)
    const [matchSwarmConns, setMatchSwarmConns] = React.useState(0)
    const [matchSwarmGid, setMatchSwarmGid] = React.useState(null)
    const [chatInput, setChatInput] = React.useState('')
    const [chatMessages, setChatMessages] = React.useState([])
    const [chatLimit, setChatLimit] = React.useState(initialChatLimit)
    const [mapOptions, setMapOptions] = React.useState([])
    const [mapError, setMapError] = React.useState('')
    const wadCacheRef = React.useRef(null)
    const mapCacheRef = React.useRef(readMapCache())
    const audioCtxRef = React.useRef(null)
    const metaRef = React.useRef({ ws: null, port: null })
    const metaOutboxRef = React.useRef([])
    const clientIdRef = React.useRef(null)
    const rosterRef = React.useRef(new Map())
    const currentMatchRef = React.useRef(null)
    const matchesRef = React.useRef(new Map())
    const chatSeenRef = React.useRef(new Set())
    const chatBacklogRef = React.useRef([])
    const chatTotalRef = React.useRef(0)
    const chatLoadRef = React.useRef({ loading: false, lastLen: null })
    const peerNicksRef = React.useRef(peerNicks)
    const chatBoxRef = React.useRef(null)
    const chatAutoScrollRef = React.useRef(true)
    const nickSaveTimerRef = React.useRef(null)
    const lastSavedNickRef = React.useRef('')
    const wadHashCacheRef = React.useRef(new Map())
    const bundledHashRef = React.useRef(new Map())
    const wadFilesRef = React.useRef([])
    const matchDebugRef = React.useRef({ sentAt: 0, recvAt: 0, sentGid: null, recvGid: null })
    const matchAnnounceSeqRef = React.useRef(0)
    const [matchDebugTick, setMatchDebugTick] = React.useState(0)
    const doomRuntimeRef = React.useRef({ module: null, script: null, running: false, frame: null })
    const endingMatchRef = React.useRef(false)
    const canvasRef = React.useRef(null)
    const canvasWrapRef = React.useRef(null)
    const timerTrackerRef = React.useRef({
      installed: false,
      enabled: false,
      timeouts: new Set(),
      intervals: new Set(),
      originals: null
    })
    const persistTimerRef = React.useRef(null)
    const hydratedRef = React.useRef(false)
    const stageRef = React.useRef(stage)
    const nickRef = React.useRef(nick)
    const mapInputRef = React.useRef(mapInput)
    const pendingJoinRef = React.useRef(pendingJoin)
    const startedBroadcastRef = React.useRef(null)
    const gameStartedRef = React.useRef(null)

    function setTimeoutUntracked (handler, timeout, ...rest) {
      return setTimeout(handler, timeout, ...rest)
    }

    function sleepUntracked (ms) {
      return new Promise((resolve) => setTimeoutUntracked(resolve, ms))
    }

    async function isGameActiveForHost (gid) {
      if (!gid) return false
      try {
        const serverRec = await peer.base.view.get(`game/${gid}/server`)
        const activeRec = await peer.base.view.get(`game/${gid}/active`)
        const server = serverRec && serverRec.value != null ? String(serverRec.value) : null
        const active = activeRec && activeRec.value != null ? activeRec.value : null
        if (!server || server !== peer.wallet.publicKey) return false
        return active === 1 || active === '1'
      } catch {
        return false
      }
    }

    async function waitForGameReady (gid, expectedServer, opts = {}) {
      if (!gid) return false
      const timeoutMs = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : 30000
      const intervalMs = Number.isFinite(opts.intervalMs) ? opts.intervalMs : 250
      const start = Date.now()
      while (true) {
        let server = null
        let active = null
        try {
          const serverRec = await peer.base.view.get(`game/${gid}/server`)
          const activeRec = await peer.base.view.get(`game/${gid}/active`)
          if (serverRec && serverRec.value != null) server = String(serverRec.value)
          if (activeRec && activeRec.value != null) active = activeRec.value
        } catch {}
        if (server && (!expectedServer || server === expectedServer) && (active === 1 || active === '1')) return true
        if (timeoutMs >= 0 && (Date.now() - start) > timeoutMs) return false
        await sleepUntracked(intervalMs)
      }
    }

    function persistUiStateNow () {
      try {
        if (typeof localStorage === 'undefined') return
        const payload = {
          nick: sanitizeNick(nick),
          gameMode,
          noMonsters: !!noMonsters,
          maxPlayers: clampPlayers(maxPlayers, DEFAULT_PLAYERS),
          mapInput: typeof mapInput === 'string' ? mapInput : '',
          skill: clampSkill(skill, DEFAULT_SKILL),
          scoreMode,
          chatLimit,
          wadDir: typeof wadDir === 'string' ? wadDir : '',
          selectedIwad: typeof selectedIwad === 'string' ? selectedIwad : DEFAULT_BUNDLED_IWAD_KEY,
          selectedPwads: Array.isArray(selectedPwads) ? selectedPwads : []
        }
        localStorage.setItem(UI_STATE_KEY, JSON.stringify(payload))
      } catch {}
    }

    function schedulePersistUiState () {
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current)
      persistTimerRef.current = setTimeoutUntracked(() => {
        persistTimerRef.current = null
        persistUiStateNow()
      }, 150)
    }

    function reloadAppSoon (delay = 200) {
      try {
        persistUiStateNow()
        setTimeoutUntracked(() => {
          try { if (typeof location !== 'undefined' && typeof location.reload === 'function') location.reload() } catch {}
        }, delay)
      } catch {}
    }

    function enableRuntimeTimerTracking () {
      const tracker = timerTrackerRef.current
      if (!tracker) return
      if (!tracker.installed) {
        const originals = {
          setTimeout: window.setTimeout,
          clearTimeout: window.clearTimeout,
          setInterval: window.setInterval,
          clearInterval: window.clearInterval
        }
        tracker.originals = originals
        window.setTimeout = function (handler, timeout, ...args) {
          const id = originals.setTimeout(handler, timeout, ...args)
          if (tracker.enabled) tracker.timeouts.add(id)
          return id
        }
        window.clearTimeout = function (id) {
          tracker.timeouts.delete(id)
          return originals.clearTimeout(id)
        }
        window.setInterval = function (handler, timeout, ...args) {
          const id = originals.setInterval(handler, timeout, ...args)
          if (tracker.enabled) tracker.intervals.add(id)
          return id
        }
        window.clearInterval = function (id) {
          tracker.intervals.delete(id)
          return originals.clearInterval(id)
        }
        tracker.installed = true
      }
      tracker.enabled = true
    }

    function disableRuntimeTimerTracking () {
      const tracker = timerTrackerRef.current
      if (!tracker || !tracker.installed || !tracker.originals) return
      for (const id of tracker.timeouts) {
        try { tracker.originals.clearTimeout(id) } catch {}
      }
      for (const id of tracker.intervals) {
        try { tracker.originals.clearInterval(id) } catch {}
      }
      tracker.timeouts.clear()
      tracker.intervals.clear()
      tracker.enabled = false
      window.setTimeout = tracker.originals.setTimeout
      window.clearTimeout = tracker.originals.clearTimeout
      window.setInterval = tracker.originals.setInterval
      window.clearInterval = tracker.originals.clearInterval
      tracker.installed = false
      tracker.originals = null
    }

    if (!hydratedRef.current) {
      hydratedRef.current = true
    }

    function isWsOpen (ws) {
      try { return ws && (ws.readyState === 1 || ws.readyState === WebSocket.OPEN) } catch { return false }
    }

    function flushMetaOutbox (ws) {
      if (!isWsOpen(ws)) return
      const outbox = metaOutboxRef.current
      if (!outbox || outbox.length === 0) return
      const pending = outbox.splice(0, outbox.length)
      for (const payload of pending) {
        try { ws.send(payload) } catch {}
      }
    }

    function sendMeta (msg) {
      const ws = metaRef.current.ws
      let payloadMsg = msg
      if (msg && typeof msg === 'object' && Object.prototype.hasOwnProperty.call(msg, 'rid')) {
        payloadMsg = { ...msg }
        delete payloadMsg.rid
      }
      const payload = JSON.stringify(payloadMsg)
      if (isWsOpen(ws)) {
        try { ws.send(payload); return true } catch {}
      }
      const outbox = metaOutboxRef.current
      if (outbox.length < 200) outbox.push(payload)
      return false
    }

    function upsertPresence (info) {
      if (!info || !info.address) return
      const now = Date.now()
      setPresence((prev) => {
        const next = new Map(prev)
        const existing = next.get(info.address) || {}
        next.set(info.address, { ...existing, ...info, lastSeenMs: now })
        return next
      })
    }

    function upsertMatch (match) {
      if (!match || !match.gid) return
      const now = Date.now()
      const clean = (() => {
        if (!match || typeof match !== 'object') return match
        const c = { ...match }
        delete c.rid
        delete c.announceTs
        delete c.announceSeq
        if (typeof c.hostNick === 'string') c.hostNick = sanitizeNick(c.hostNick)
        if (typeof c.iwad === 'string') c.iwad = sanitizeFilename(c.iwad) || c.iwad
        if (Array.isArray(c.pwads)) {
          c.pwads = c.pwads.map((p) => sanitizeFilename(p) || p).filter(Boolean)
        }
        return c
      })()
      setMatches((prev) => {
        const next = new Map(prev)
        const existing = next.get(clean.gid) || {}
        next.set(clean.gid, { ...existing, ...clean, lastSeenMs: now })
        return next
      })
    }

    function removeMatch (gid) {
      if (!gid) return
      setMatches((prev) => {
        if (!prev.has(gid)) return prev
        const next = new Map(prev)
        next.delete(gid)
        return next
      })
    }

    function primeAudioContext () {
      if (noSound) return false
      const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext
      if (!Ctx) return false
      if (!audioCtxRef.current) {
        try { audioCtxRef.current = new Ctx() } catch { return false }
      }
      try {
        if (audioCtxRef.current.state === 'suspended') {
          const p = audioCtxRef.current.resume()
          if (p && typeof p.catch === 'function') p.catch(() => {})
        }
      } catch {}
      return audioCtxRef.current.state === 'running'
    }

    async function audioPreflight () {
      if (noSound) return true
      const ctx = audioCtxRef.current
      if (!ctx) return false
      try {
        if (ctx.state === 'suspended') {
          await ctx.resume()
        }
      } catch {
        return false
      }
      return new Promise((resolve) => {
        let done = false
        let timer = null
        let osc = null
        let gain = null
        let proc = null
        const finish = (ok) => {
          if (done) return
          done = true
          if (timer) clearTimeout(timer)
          try { if (proc) proc.disconnect() } catch {}
          try { if (gain) gain.disconnect() } catch {}
          try { if (osc) osc.stop() } catch {}
          resolve(ok)
        }
        try {
          proc = ctx.createScriptProcessor(256, 0, 1)
          proc.onaudioprocess = () => finish(true)
          gain = ctx.createGain()
          gain.gain.value = 0
          osc = ctx.createOscillator()
          osc.connect(gain)
          gain.connect(ctx.destination)
          proc.connect(ctx.destination)
          osc.start()
          if (audioPreflightMs > 0) timer = setTimeout(() => finish(false), audioPreflightMs)
        } catch {
          finish(false)
        }
      })
    }

    React.useEffect(() => {
      let mounted = true
      if (!clientIdRef.current) clientIdRef.current = randomId()
      ;(async () => {
        try {
          const n = await peer.protocol_instance.api.getNick(peer.wallet.publicKey)
          if (mounted && n) {
            lastSavedNickRef.current = n
            setNick(n)
            setNickDirty(false)
            setNickSaving(false)
          }
        } catch {}
      })()
      async function resolveNicks (addrs) {
        try {
          const m = new Map(peerNicks)
          for (const a of addrs) {
            if (!m.has(a) && peer?.protocol_instance?.api?.getNick) {
              try {
                const n = await peer.protocol_instance.api.getNick(a)
                if (typeof n === 'string' && n.length) m.set(a, n)
              } catch {}
            }
          }
          if (mounted) setPeerNicks(m)
        } catch {}
      }
      const iv = setInterval(() => {
        const list = Array.from(peer.connectedPeers)
        setPeers(list)
        resolveNicks(list)
      }, 1000)
      return () => { mounted = false; clearInterval(iv) }
    }, [])

    React.useEffect(() => {
      let mounted = true
      async function tick () {
        try {
          const info = await RPC.get('/ws/info')
          if (!mounted) return
          const conns = (info && typeof info.matchConns === 'number') ? info.matchConns : 0
          const gid = info && info.matchGid ? String(info.matchGid) : null
          setMatchSwarmConns(conns)
          setMatchSwarmGid(gid)
        } catch {}
      }
      tick()
      const iv = setInterval(tick, 1000)
      return () => { mounted = false; clearInterval(iv) }
    }, [])

    React.useEffect(() => {
      let mounted = true
      ;(async () => {
        try {
          const usesFolder = wadDir && (!isBundledIwadKey(selectedIwad) || selectedPwads.length > 0)
          const filesLive = (wadFilesRef.current && wadFilesRef.current.length)
            ? wadFilesRef.current
            : wadFiles
          if (usesFolder && (!filesLive || filesLive.length === 0)) {
            if (mounted) {
              setWadError('')
              setMapOptions([])
              setMapError('')
            }
            return
          }
          if (usesFolder && filesLive && filesLive.length) {
            const iwadNames = new Set(filesLive.filter((f) => f.kind === 'iwad').map((f) => f.name))
            const pwadNames = new Set(filesLive.filter((f) => f.kind === 'pwad').map((f) => f.name))
            if (!isBundledIwadKey(selectedIwad) && selectedIwad && !iwadNames.has(selectedIwad)) {
              if (mounted) {
                setWadError('')
                setMapOptions([])
                setMapError('')
              }
              return
            }
            if (selectedPwads && selectedPwads.length) {
              const missing = selectedPwads.find((p) => !pwadNames.has(p))
              if (missing) {
                if (mounted) {
                  setWadError('')
                  setMapOptions([])
                  setMapError('')
                }
                return
              }
            }
          }
          const data = await ensureWadData()
          const key = mapCacheKey(data)
          const cache = mapCacheRef.current || { order: [], data: {} }
          const cached = key && cache.data && cache.data[key]
          let options = []
          let values = []
          if (cached && Array.isArray(cached.options) && Array.isArray(cached.values)) {
            options = cached.options
            values = cached.values
          } else {
            const built = buildMapOptions(data)
            options = Array.isArray(built.options) ? built.options : []
            values = Array.isArray(built.values) ? built.values : []
          }
          if (mounted) {
            setMapOptions(options)
            const current = String(mapInputRef.current || '').toUpperCase()
            if (!values.length) {
              setMapError('No maps found in selected IWAD/PWAD set.')
            } else if (current && !values.includes(current)) {
              setMapInput('')
              setMapError('')
            } else {
              setMapError('')
            }
          }
          if (key && values.length) {
            cache.data = cache.data || {}
            cache.order = Array.isArray(cache.order) ? cache.order : []
            cache.data[key] = { options, values, ts: Date.now() }
            if (!cache.order.includes(key)) cache.order.push(key)
            while (cache.order.length > MAP_CACHE_LIMIT) {
              const old = cache.order.shift()
              if (old) delete cache.data[old]
            }
            mapCacheRef.current = cache
            writeMapCache(cache)
          }
        } catch (e) {
          if (!mounted) return
          const msg = String(e?.message || e || '')
          if (isTransientWadError(msg)) {
            setWadError('')
            setMapOptions([])
            setMapError('')
            return
          }
          wadCacheRef.current = null
          setWadInfo(null)
          setWadError(msg)
          setMapOptions([])
          setMapError('')
        }
      })()
      return () => { mounted = false }
    }, [wadDir, selectedIwad, selectedPwads, wadFiles])

    React.useEffect(() => {
      currentMatchRef.current = currentMatch
    }, [currentMatch])

    React.useEffect(() => {
      matchesRef.current = matches
    }, [matches])

    React.useEffect(() => {
      loadScoreboard(scoreMode).catch(() => {})
    }, [scoreMode])

    React.useEffect(() => {
      loadAchievements().catch(() => {})
    }, [])

    function applyWadDir (value) {
      const next = normalizeWadDir(value)
      setWadDirInput(next)
      if (!next) {
        setWadScanError('')
        if (wadDir) setWadDir('')
        return
      }
      try {
        if (!fs || !fs.statSync) throw new Error('Filesystem unavailable')
        const stat = fs.statSync(next)
        if (!stat.isDirectory()) throw new Error('Not a directory')
      } catch {
        setWadScanError(`WAD folder not found: ${next}`)
        return
      }
      setWadScanError('')
      if (next !== wadDir) setWadDir(next)
    }

    React.useEffect(() => {
      if (wadDirInput !== wadDir) setWadDirInput(wadDir || '')
    }, [wadDir])

    React.useEffect(() => {
      let mounted = true
      async function scan () {
        if (!wadDir) {
          if (!mounted) return
          setWadFiles([])
          setWadScanError('')
          return
        }
        try {
          const files = await listWadFiles(wadDir)
          if (!mounted) return
          const map = new Map()
          const dupes = new Set()
          for (const f of files) {
            const safeName = sanitizeFilename(f.name)
            if (!safeName) continue
            if (map.has(safeName)) {
              dupes.add(safeName)
              continue
            }
            map.set(safeName, {
              ...f,
              name: safeName,
              rawName: f.name,
              kind: f.kind || 'unknown'
            })
          }
          setWadFiles(Array.from(map.values()))
          if (dupes.size) {
            setWadScanError(`Duplicate WAD filename after sanitization: ${Array.from(dupes).join(', ')}`)
          } else {
            setWadScanError('')
          }
        } catch (e) {
          if (!mounted) return
          setWadFiles([])
          setWadScanError(String(e?.message || e))
        }
      }
      scan()
      const iv = setInterval(scan, wadScanMs)
      return () => { mounted = false; clearInterval(iv) }
    }, [wadDir])

    React.useEffect(() => {
      if (!wadFiles || wadFiles.length === 0) {
        if (wadDir) return
        if (!isBundledIwadKey(selectedIwad)) setSelectedIwad(DEFAULT_BUNDLED_IWAD_KEY)
        if (selectedPwads.length) setSelectedPwads([])
        return
      }
      const iwadFiles = wadFiles.filter((f) => f.kind === 'iwad')
      const pwadFiles = wadFiles.filter((f) => f.kind === 'pwad')
      const iwadNames = new Set(iwadFiles.map((f) => f.name))
      const pwadNames = new Set(pwadFiles.map((f) => f.name))
      const iwadByLower = new Map(iwadFiles.map((f) => [f.name.toLowerCase(), f.name]))
      const pwadByLower = new Map(pwadFiles.map((f) => [f.name.toLowerCase(), f.name]))
      if (selectedIwad && !isBundledIwadKey(selectedIwad) && !iwadNames.has(selectedIwad)) {
        const matched = iwadByLower.get(String(selectedIwad).toLowerCase())
        setSelectedIwad(matched || DEFAULT_BUNDLED_IWAD_KEY)
      }
      if (selectedPwads && selectedPwads.length) {
        const next = []
        for (const p of selectedPwads) {
          if (!p) continue
          let name = p
          if (!pwadNames.has(name)) {
            const match = pwadByLower.get(String(name).toLowerCase())
            if (!match) continue
            name = match
          }
          if (name === selectedIwad) continue
          next.push(name)
        }
        if (next.length !== selectedPwads.length || next.some((v, i) => v !== selectedPwads[i])) {
          setSelectedPwads(next)
        }
      }
    }, [wadFiles, wadDir, selectedIwad, selectedPwads])

    React.useEffect(() => {
      wadHashCacheRef.current = new Map()
    }, [wadDir])

    React.useEffect(() => {
      const value = sanitizeNick(nick || '')
      if (!value) {
        if (lastSavedNickRef.current) setNickDirty(true)
        return
      }
      if (value === lastSavedNickRef.current) {
        setNickDirty(false)
        return
      }
      setNickDirty(true)
      if (nickSaveTimerRef.current) clearTimeout(nickSaveTimerRef.current)
      nickSaveTimerRef.current = setTimeout(() => {
        saveNick({ value })
      }, nickSaveDelayMs)
      return () => {
        if (nickSaveTimerRef.current) {
          clearTimeout(nickSaveTimerRef.current)
          nickSaveTimerRef.current = null
        }
      }
    }, [nick])

    const resizeCanvasToWrap = React.useCallback(() => {
      const wrap = canvasWrapRef.current
      const canvas = canvasRef.current
      if (!wrap || !canvas) return false
      const rect = wrap.getBoundingClientRect()
      const maxW = Math.max(0, rect.width)
      const maxH = Math.max(0, rect.height)
      if (!maxW || !maxH) return false
      const aspect = 4 / 3
      let width = maxW
      let height = maxW / aspect
      if (height > maxH) {
        height = maxH
        width = maxH * aspect
      }
      width = Math.max(320, Math.floor(width))
      height = Math.max(240, Math.floor(height))
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      if (canvas.width !== width) canvas.width = width
      if (canvas.height !== height) canvas.height = height
      return true
    }, [])

    React.useEffect(() => {
      const wrap = canvasWrapRef.current
      if (!wrap) return
      resizeCanvasToWrap()
      const ro = new ResizeObserver(() => resizeCanvasToWrap())
      ro.observe(wrap)
      window.addEventListener('resize', resizeCanvasToWrap)
      return () => {
        ro.disconnect()
        window.removeEventListener('resize', resizeCanvasToWrap)
      }
    }, [stage, resizeCanvasToWrap])

    async function loadChatHistory (limit, opts = {}) {
      const force = !!opts.force
      const cappedLimit = Math.min(chatLimitMax, Math.max(1, Number.isFinite(limit) ? limit : 0))
      if (!Number.isFinite(cappedLimit) || cappedLimit <= 0) {
        chatBacklogRef.current = []
        chatTotalRef.current = 0
        chatLoadRef.current.lastLen = 0
        chatSeenRef.current = new Set()
        setChatMessages([])
        return
      }
      if (chatLoadRef.current.loading && !force) return
      chatLoadRef.current.loading = true
      try {
        let total = (typeof opts.totalLen === 'number') ? opts.totalLen : null
        if (total === null) {
          const lenRec = await peer.base.view.get('msgl')
          total = (lenRec && lenRec.value != null) ? parseInt(lenRec.value) : 0
        }
        if (!Number.isFinite(total) || total < 0) total = 0
        chatTotalRef.current = total
        chatLoadRef.current.lastLen = total
        if (total === 0) {
          chatBacklogRef.current = []
          chatSeenRef.current = new Set()
          setChatMessages([])
          return
        }
        const start = Math.max(0, total - cappedLimit)
        const out = []
        const nickCache = new Map(peerNicksRef.current || [])
        const missing = new Set()
        for (let i = start; i < total; i++) {
          let rec = null
          try { rec = await peer.base.view.get('msg/' + i) } catch {}
          const msgVal = rec && rec.value ? rec.value : null
          const text = sanitizeChat(msgVal && typeof msgVal.msg === 'string' ? msgVal.msg : '')
          if (!text) continue
          const from = (msgVal && typeof msgVal.address === 'string') ? msgVal.address : ''
          if (from && !nickCache.has(from) && Array.isArray(msgVal?.attachments)) {
            const raw = msgVal.attachments.find((a) => typeof a === 'string' && a.startsWith('nick:'))
            if (raw) {
              const inlineNick = sanitizeNick(raw.slice(5))
              if (inlineNick) nickCache.set(from, inlineNick)
            }
          }
          if (from && !nickCache.has(from)) missing.add(from)
          out.push({
            id: `msg-${i}`,
            from,
            nick: from ? (nickCache.get(from) || null) : null,
            text,
            ts: Date.now(),
            system: false
          })
        }
        if (missing.size > 0) {
          for (const addr of missing) {
            try {
              let n = await peer.protocol_instance.api.getNick(addr)
              if ((!n || typeof n !== 'string' || !n.length) && peer?.base?.view?.get) {
                const rec = await peer.base.view.get('nick/' + addr)
                if (rec && typeof rec.value === 'string' && rec.value.length) n = rec.value
              }
              if (typeof n === 'string' && n.length) nickCache.set(addr, n)
            } catch {}
          }
          if (missing.size > 0) setPeerNicks(nickCache)
          for (const entry of out) {
            if (entry.from && nickCache.has(entry.from)) entry.nick = nickCache.get(entry.from)
          }
        }
        const selfNick = sanitizeNick(nickRef.current || nick)
        if (selfNick) {
          const selfAddr = peer.wallet.publicKey
          nickCache.set(selfAddr, selfNick)
          for (const entry of out) {
            if (entry.from === selfAddr) entry.nick = selfNick
          }
        }
        chatBacklogRef.current = out
        chatSeenRef.current = new Set(out.map((m) => m.id))
        setChatMessages(out.slice(Math.max(0, out.length - cappedLimit)))
      } finally {
        chatLoadRef.current.loading = false
      }
    }

    function pushChatMessage (msg) {
      if (!msg || typeof msg.text !== 'string') return
      const text = sanitizeChat(msg.text)
      if (!text) return
      const id = (typeof msg.rid === 'string' && msg.rid.length) ? msg.rid
        : (typeof msg.id === 'string' && msg.id.length ? msg.id : `${msg.from || 'anon'}:${msg.ts || Date.now()}:${text}`)
      const seen = chatSeenRef.current
      if (seen.has(id)) return
      seen.add(id)
      if (seen.size > 500) {
        let count = 0
        for (const k of seen.keys()) { seen.delete(k); if (++count > 100) break }
      }
      const entry = {
        id,
        from: msg.from || '',
        nick: msg.nick || null,
        text,
        ts: typeof msg.ts === 'number' ? msg.ts : Date.now(),
        system: !!msg.system
      }
      chatBacklogRef.current = [...chatBacklogRef.current, entry].slice(-chatLimitMax)
      setChatMessages(chatBacklogRef.current.slice(Math.max(0, chatBacklogRef.current.length - chatLimit)))
    }

    React.useEffect(() => {
      setChatMessages(chatBacklogRef.current.slice(Math.max(0, chatBacklogRef.current.length - chatLimit)))
    }, [chatLimit])

    React.useEffect(() => {
      let cancelled = false
      async function refresh (force = false) {
        if (cancelled) return
        if (chatLoadRef.current.loading) return
        let total = 0
        try {
          const lenRec = await peer.base.view.get('msgl')
          total = (lenRec && lenRec.value != null) ? parseInt(lenRec.value) : 0
          if (!Number.isFinite(total) || total < 0) total = 0
        } catch {
          total = 0
        }
        const last = chatLoadRef.current.lastLen
        if (force || last === null || total !== last || chatBacklogRef.current.length === 0) {
          await loadChatHistory(chatLimit, { totalLen: total })
        } else {
          chatTotalRef.current = total
        }
      }
      refresh(true)
      const iv = setInterval(() => { refresh(false) }, 2000)
      return () => { cancelled = true; clearInterval(iv) }
    }, [chatLimit])

    React.useEffect(() => {
      const box = chatBoxRef.current
      if (!box) return
      if (chatAutoScrollRef.current) {
        box.scrollTop = box.scrollHeight
      }
    }, [chatMessages])

    React.useEffect(() => {
      schedulePersistUiState()
    }, [nick, gameMode, noMonsters, maxPlayers, mapInput, skill, scoreMode, chatLimit, wadDir, selectedIwad, selectedPwads])

    React.useEffect(() => {
      stageRef.current = stage
    }, [stage])

    React.useEffect(() => {
      nickRef.current = nick
    }, [nick])

    React.useEffect(() => {
      mapInputRef.current = mapInput
    }, [mapInput])

    React.useEffect(() => {
      peerNicksRef.current = peerNicks
    }, [peerNicks])

    React.useEffect(() => {
      wadFilesRef.current = wadFiles
    }, [wadFiles])

    React.useEffect(() => {
      pendingJoinRef.current = pendingJoin
    }, [pendingJoin])

    React.useEffect(() => {
      let ws = null
      let closed = false
      let currentPort = null
      let reconnectTimer = null
      function buildPresencePayload () {
        const me = peer.wallet.publicKey
        const status = (stageRef.current === 'running')
          ? 'in_game'
          : (currentMatchRef.current && currentMatchRef.current.host === me)
              ? 'host'
              : (pendingJoinRef.current ? 'joining' : 'idle')
        return {
          t: 'presence',
          address: me,
          nick: sanitizeNick(nickRef.current || '') || null,
          clientId: clientIdRef.current,
          status,
          matchGid: currentMatchRef.current ? currentMatchRef.current.gid : null
        }
      }
      async function connect (port) {
        if (!port || closed) return
        currentPort = port
        setMetaConnected(false)
        setMetaLastMsgAt(0)
        const url = `ws://127.0.0.1:${port}/meta`
        try {
          const NodeWS = await ensureNodeWebSocket()
          ws = NodeWS ? new NodeWS(url) : new WebSocket(url)
        } catch {
          ws = new WebSocket(url)
        }
        metaRef.current.ws = ws
        metaRef.current.port = port
        const handleMessage = (data) => {
          try {
            const raw = wsDataToString(data)
            if (!raw) return
            setMetaLastMsgAt(Date.now())
            const msg = JSON.parse(raw)
            if (!msg || typeof msg.t !== 'string') return
            if (msg.t === 'mode') {
              const mode = normalizeGameMode(msg.mode)
              setHostMode(mode)
              setHostNoMonsters(!!msg.noMonsters)
              return
            }
            if (msg.t === 'presence') {
              const address = msg.address || msg.addr
              if (!address) return
              upsertPresence({
                address,
                nick: sanitizeNick(msg.nick || '') || null,
                status: msg.status || 'idle',
                matchGid: msg.matchGid || null,
                clientId: msg.clientId || null
              })
              return
            }
            if (msg.t === 'match-announce' || msg.t === 'match-update' || msg.t === 'match-start') {
              if (!msg.gid) return
              matchDebugRef.current = { ...matchDebugRef.current, recvAt: Date.now(), recvGid: msg.gid }
              setMatchDebugTick((t) => (t + 1) % 1000000)
              const status = msg.status || (msg.t === 'match-start' ? 'in_game' : 'open')
              upsertMatch({ ...msg, status })
              return
            }
            if (msg.t === 'match-end') {
              if (msg.gid) {
                if (currentMatchRef.current && currentMatchRef.current.gid === msg.gid) {
                  endMatch({ reason: msg.reason || 'ended', silent: true })
                } else {
                  removeMatch(msg.gid)
                }
              }
              return
            }
            if (msg.t === 'match-accept') {
              const me = peer.wallet.publicKey
              const mine = (msg.to === me) || (msg.to === clientIdRef.current)
              if (!mine) return
              const match = msg.match || (msg.gid ? matchesRef.current.get(msg.gid) : null)
              if (!match) { setError('Match accept missing match data'); return }
              setPendingJoin(null)
              setStatus('')
              setCurrentMatch(match)
              try { sendMeta({ t: 'gid', gid: match.gid }) } catch {}
              startDoom(false, match)
              return
            }
            if (msg.t === 'match-deny') {
              const me = peer.wallet.publicKey
              const mine = (msg.to === me) || (msg.to === clientIdRef.current)
              if (!mine) return
              setPendingJoin(null)
              setStatus('')
              setError(msg.reason || 'Match join rejected')
              return
            }
            if (msg.t === 'match-join') {
              const me = peer.wallet.publicKey
              const current = currentMatchRef.current
              if (!current || current.host !== me) return
              if (msg.gid !== current.gid) return
              const roster = rosterRef.current.get(current.gid) || new Set()
              const maxPlayers = clampPlayers(parseInt(current.maxPlayers || String(DEFAULT_PLAYERS), 10), DEFAULT_PLAYERS)
              const joinAddr = msg.from
              if (!joinAddr) return
              let denyReason = null
              const joinIwadHash = msg.iwadHash ? String(msg.iwadHash) : null
              const joinPwadHashes = Array.isArray(msg.pwadHashes) ? msg.pwadHashes.map((h) => String(h)) : []
              const matchIwadHash = current.iwadHash ? String(current.iwadHash) : null
              const matchPwadHashes = Array.isArray(current.pwadHashes) ? current.pwadHashes.map((h) => String(h)) : []
              if (matchIwadHash) {
                if (!joinIwadHash || joinIwadHash !== matchIwadHash) denyReason = 'wad_mismatch'
              }
              if (!denyReason && matchPwadHashes.length) {
                if (!joinPwadHashes.length || joinPwadHashes.length !== matchPwadHashes.length) denyReason = 'wad_mismatch'
                else {
                  for (let i = 0; i < matchPwadHashes.length; i++) {
                    if (joinPwadHashes[i] !== matchPwadHashes[i]) { denyReason = 'wad_mismatch'; break }
                  }
                }
              }
              if (!denyReason && msg.wadHash && current.wadHash && msg.wadHash !== current.wadHash) denyReason = 'wad_mismatch'
              else if (roster.size >= maxPlayers) denyReason = 'match_full'
              if (denyReason) {
                sendMeta({ t: 'match-deny', gid: current.gid, to: joinAddr, reason: denyReason })
                return
              }
              roster.add(joinAddr)
              rosterRef.current.set(current.gid, roster)
              const update = {
                gid: current.gid,
                players: Array.from(roster),
                maxPlayers: String(maxPlayers),
                status: roster.size >= maxPlayers ? 'full' : 'open'
              }
              upsertMatch(update)
              sendMeta({ t: 'match-update', ...update })
              sendMeta({ t: 'match-accept', gid: current.gid, to: joinAddr, match: current })
              return
            }
            if (msg.t === 'match-leave') {
              const me = peer.wallet.publicKey
              const current = currentMatchRef.current
              if (!current || current.host !== me) return
              if (msg.gid !== current.gid) return
              const leaveAddr = msg.from
              if (!leaveAddr || leaveAddr === me) return
              const roster = rosterRef.current.get(current.gid)
              if (!roster || !roster.has(leaveAddr)) return
              roster.delete(leaveAddr)
              rosterRef.current.set(current.gid, roster)
              const maxPlayers = clampPlayers(parseInt(current.maxPlayers || String(DEFAULT_PLAYERS), 10), DEFAULT_PLAYERS)
              const update = {
                gid: current.gid,
                players: Array.from(roster),
                maxPlayers: String(maxPlayers),
                status: roster.size >= maxPlayers ? 'full' : 'open'
              }
              upsertMatch(update)
              setCurrentMatch((prev) => (prev && prev.gid === current.gid) ? { ...prev, ...update } : prev)
              sendMeta({ t: 'match-update', ...update })
              return
            }
          } catch {}
        }
        if (typeof ws.on === 'function') {
          ws.on('message', handleMessage)
          ws.on('open', () => {
            setMetaConnected(true)
            try { sendMeta(buildPresencePayload()) } catch {}
            try { sendMeta({ t: 'match-list-req' }) } catch {}
            flushMetaOutbox(ws)
          })
          ws.on('close', () => {
            if (closed) return
            setMetaConnected(false)
            metaRef.current.ws = null
            reconnectTimer = setTimeoutUntracked(() => connect(currentPort), 2000)
          })
        } else {
          ws.onopen = () => {
            setMetaConnected(true)
            try { sendMeta(buildPresencePayload()) } catch {}
            try { sendMeta({ t: 'match-list-req' }) } catch {}
            flushMetaOutbox(ws)
          }
          ws.onmessage = (ev) => handleMessage(ev.data)
          ws.onclose = () => {
            if (closed) return
            setMetaConnected(false)
            metaRef.current.ws = null
            reconnectTimer = setTimeoutUntracked(() => connect(currentPort), 2000)
          }
        }
      }
      function tick () {
        const p = (peer && typeof peer.dnetPort === 'number') ? peer.dnetPort : dnetPortEnv
        if (p && p !== currentPort) {
          try { if (ws) ws.close() } catch {}
          connect(p)
        }
      }
      tick()
      const iv = setInterval(tick, 1000)
      return () => {
        closed = true
        clearInterval(iv)
        if (reconnectTimer) clearTimeout(reconnectTimer)
        try { if (ws) ws.close() } catch {}
      }
    }, [])

    React.useEffect(() => {
      const iv = setInterval(() => {
        const me = peer.wallet.publicKey
        const status = (stageRef.current === 'running')
          ? 'in_game'
          : (currentMatchRef.current && currentMatchRef.current.host === me)
              ? 'host'
              : (pendingJoinRef.current ? 'joining' : 'idle')
        sendMeta({
          t: 'presence',
          address: me,
          nick: nickRef.current || null,
          clientId: clientIdRef.current,
          status,
          matchGid: currentMatchRef.current ? currentMatchRef.current.gid : null
        })
      }, 2000)
      return () => { clearInterval(iv) }
    }, [])

    React.useEffect(() => {
      const iv = setInterval(() => {
        const match = currentMatchRef.current
        if (!match || !match.gid) return
        if (match.host !== peer.wallet.publicKey) return
        const latest = matchesRef.current.get(match.gid) || match
        const status = latest.status || 'open'
        if (status === 'ended' || status === 'in_game') return
        matchDebugRef.current = { ...matchDebugRef.current, sentAt: Date.now(), sentGid: match.gid }
        const announceSeq = (matchAnnounceSeqRef.current = (matchAnnounceSeqRef.current + 1) % 1000000000)
        const announce = { ...latest, announceTs: Date.now(), announceSeq }
        sendMeta({ t: 'match-announce', ...announce })
        setMatchDebugTick((t) => (t + 1) % 1000000)
      }, 3000)
      return () => { clearInterval(iv) }
    }, [])

    React.useEffect(() => {
      const iv = setInterval(() => {
        const now = Date.now()
        setPresence((prev) => {
          const next = new Map(prev)
          for (const [addr, info] of next.entries()) {
            if (info && info.lastSeenMs && now - info.lastSeenMs > presenceTtlMs) next.delete(addr)
          }
          return next
        })
        setMatches((prev) => {
          const next = new Map(prev)
          for (const [gid, info] of next.entries()) {
            if (!info || (info.lastSeenMs && now - info.lastSeenMs > matchTtlMs)) {
              next.delete(gid)
            }
          }
          return next
        })
      }, 2000)
      return () => { clearInterval(iv) }
    }, [])

    async function saveNick (opts = {}) {
      const value = sanitizeNick((opts.value != null ? opts.value : (nickRef.current || nick)) + '')
      if (!value) {
        setError('Invalid nick')
        return
      }
      if (value === lastSavedNickRef.current) {
        setNickDirty(false)
        return
      }
      if (nickSaveTimerRef.current) {
        clearTimeout(nickSaveTimerRef.current)
        nickSaveTimerRef.current = null
      }
      setNickSaving(true)
      try {
        await RPC.post('/setNick', { nick: value })
        lastSavedNickRef.current = value
        if (sanitizeNick(nickRef.current || nick) === value) {
          setNickDirty(false)
        } else {
          setNickDirty(true)
        }
        if (value !== nick) setNick(value)
      } catch (e) {
        setError(String(e))
        setNickDirty(true)
      } finally {
        setNickSaving(false)
      }
    }

    function getBundledWadDir () {
      return runtimeRoot ? path.join(runtimeRoot, 'third_party/doom-wasm/src') : 'third_party/doom-wasm/src'
    }

    function getBundledWadPath (name) {
      const file = name || DEFAULT_BUNDLED_IWAD.name
      return path.join(getBundledWadDir(), file)
    }

    function getBundledRelPath (name) {
      const file = name || DEFAULT_BUNDLED_IWAD.name
      return path.join('third_party', 'doom-wasm', 'src', file)
    }

    function getWadFileByName (name) {
      if (!name) return null
      const files = (wadFilesRef.current && wadFilesRef.current.length)
        ? wadFilesRef.current
        : wadFiles
      let fallback = null
      const target = String(name)
      const lower = target.toLowerCase()
      for (const f of files) {
        if (!f || !f.name) continue
        if (f.name === target) return f
        if (!fallback && f.name.toLowerCase() === lower) fallback = f
      }
      return fallback
    }

    async function getBundledWadHash (name) {
      const fileName = name || DEFAULT_BUNDLED_IWAD.name
      const cache = bundledHashRef.current
      if (cache && cache.has(fileName)) return cache.get(fileName)
      try {
        const bundledDir = getBundledWadDir()
        const bundledPath = getBundledWadPath(fileName)
        const cfg = {
          wadDir: bundledDir,
          wadDirRel: runtimeRoot ? path.relative(runtimeRoot, bundledDir) : bundledDir,
          iwadPath: bundledPath,
          iwadName: fileName,
          iwadRelPath: getBundledRelPath(fileName),
          pwadPaths: [],
          pwadNames: [],
          errors: []
        }
        const data = await readWadFiles(cfg, { fetcher: (typeof fetch === 'function') ? fetch : null })
        const hash = hashWadBuffer(data.iwad.buf)
        if (cache) cache.set(fileName, hash)
        return hash
      } catch {
        return null
      }
    }

    async function ensureWadData (opts = {}) {
      const wadFilesLive = (wadFilesRef.current && wadFilesRef.current.length)
        ? wadFilesRef.current
        : wadFiles
      const selection = {
        wadDir: (typeof opts.wadDir === 'string') ? opts.wadDir : (typeof wadDir === 'string' ? wadDir : ''),
        selectedIwad: (typeof opts.selectedIwad === 'string') ? opts.selectedIwad : (typeof selectedIwad === 'string' ? selectedIwad : DEFAULT_BUNDLED_IWAD_KEY),
        selectedPwads: Array.isArray(opts.selectedPwads) ? opts.selectedPwads : (Array.isArray(selectedPwads) ? selectedPwads : [])
      }
      const usesFolder = selection.wadDir && (!isBundledIwadKey(selection.selectedIwad) || selection.selectedPwads.length > 0)
      if (usesFolder && (!wadFilesLive || wadFilesLive.length === 0)) {
        throw new Error('Scanning WAD folder, try again shortly.')
      }
      const selectionKey = JSON.stringify(selection)
      if (wadCacheRef.current && wadCacheRef.current.key === selectionKey && wadCacheRef.current.data) {
        return wadCacheRef.current.data
      }
      const useBundled = isBundledIwadKey(selection.selectedIwad)
      const bundledEntry = useBundled ? (getBundledIwadEntry(selection.selectedIwad) || DEFAULT_BUNDLED_IWAD) : null
      const bundledName = bundledEntry ? bundledEntry.name : null
      const bundledRelPath = bundledName ? getBundledRelPath(bundledName) : null
      const pwadList = selection.selectedPwads || []
      const envConfigured = !!(env.TRAC_WAD_DIR || env.TRAC_IWAD || env.TRAC_PWADS)
      let cfg = null
      if (!selection.wadDir) {
        const useEnvConfig = envConfigured && useBundled && selection.selectedIwad === DEFAULT_BUNDLED_IWAD_KEY && pwadList.length === 0
        if (useEnvConfig) {
          cfg = resolveWadConfig(env, runtimeRoot)
          if (cfg) {
            cfg.iwadName = sanitizeFilename(cfg.iwadName) || cfg.iwadName
            if (Array.isArray(cfg.pwadNames)) {
              cfg.pwadNames = cfg.pwadNames.map((p) => sanitizeFilename(p) || p).filter(Boolean)
            }
          }
        } else if (useBundled && pwadList.length === 0) {
          const bundledDir = getBundledWadDir()
          const iwadPath = getBundledWadPath(bundledName)
          cfg = {
            wadDir: bundledDir,
            wadDirRel: runtimeRoot ? path.relative(runtimeRoot, bundledDir) : bundledDir,
            iwadPath,
            iwadName: bundledName,
            iwadRelPath: bundledRelPath || undefined,
            pwadPaths: [],
            pwadNames: [],
            errors: []
          }
        } else {
          throw new Error('Select a WAD folder for custom WAD/PWAD files.')
        }
      } else {
        const wadDirPath = selection.wadDir
        const iwadFile = useBundled ? null : getWadFileByName(selection.selectedIwad)
        if (!useBundled) {
          if (!iwadFile) throw new Error('Selected IWAD not found in folder.')
          if (iwadFile.kind && iwadFile.kind !== 'iwad') throw new Error('Selected IWAD is not an IWAD.')
        }
        const iwadName = useBundled ? bundledName : (iwadFile.rawName || iwadFile.name)
        const iwadPath = useBundled ? getBundledWadPath(bundledName) : iwadFile.path
        const pwadEntries = []
        for (const entry of pwadList) {
          const file = getWadFileByName(entry)
          if (!file) throw new Error(`PWAD not found in folder: ${entry}`)
          if (file.kind && file.kind !== 'pwad') throw new Error(`Selected PWAD is not a PWAD: ${file.name}`)
          pwadEntries.push({ name: file.rawName || file.name, path: file.path })
        }
        const pwadNamesRaw = pwadEntries.map((p) => p.name)
        const pwadPaths = pwadEntries.map((p) => p.path)
        const dupes = new Set()
        const seen = new Set()
        for (const name of pwadNamesRaw) {
          if (seen.has(name)) dupes.add(name)
          seen.add(name)
        }
        if (dupes.size) throw new Error(`Duplicate PWAD filename detected: ${Array.from(dupes).join(', ')}`)
        let wadDirRel = wadDirPath
        try {
          if (runtimeRoot && path.isAbsolute(wadDirPath) && wadDirPath.startsWith(runtimeRoot)) {
            wadDirRel = path.relative(runtimeRoot, wadDirPath) || wadDirPath
          }
        } catch {}
        cfg = {
          wadDir: wadDirPath,
          wadDirRel,
          iwadPath,
          iwadName,
          iwadRelPath: useBundled ? bundledRelPath : null,
          pwadPaths,
          pwadNames: pwadNamesRaw,
          errors: []
        }
      }
      if (cfg.errors && cfg.errors.length) throw new Error(cfg.errors.join('; '))
      const data = await readWadFiles(cfg, { fetcher: (typeof fetch === 'function') ? fetch : null })
      const iwadType = getWadTypeFromBuffer(data.iwad.buf)
      if (iwadType === 'pwad') {
        throw new Error(`Selected IWAD is actually a PWAD: ${data.iwad.name}`)
      }
      for (const pw of data.pwads) {
        const pwadType = getWadTypeFromBuffer(pw.buf)
        if (pwadType === 'iwad') {
          throw new Error(`Selected PWAD is actually an IWAD: ${pw.name}`)
        }
      }
      const iwadHash = hashWadBuffer(data.iwad.buf)
      const pwadHashes = data.pwads.map((p) => hashWadBuffer(p.buf))
      const iwadSource = useBundled ? 'bundled' : 'folder'
      const info = {
        iwad: data.iwad,
        pwads: data.pwads,
        hash: data.hash,
        iwadHash,
        pwadHashes,
        iwadSource,
        dir: cfg.wadDir
      }
      wadCacheRef.current = { key: selectionKey, data: info }
      setWadInfo({
        iwad: data.iwad.name,
        pwads: data.pwads.map((p) => p.name),
        hash: data.hash,
        iwadHash,
        pwadHashes,
        iwadSource,
        dir: cfg.wadDir
      })
      setWadError('')
      return info
    }

    async function getWadFileHash (file) {
      if (!file || !file.path) return null
      const key = `${file.path}:${file.size || 0}:${file.mtimeMs || 0}`
      const cache = wadHashCacheRef.current
      if (cache.has(key)) return cache.get(key)
      const hash = await hashWadFile(file.path)
      cache.set(key, hash)
      return hash
    }

    async function findWadByHash (hash) {
      if (!hash) return null
      const files = (wadFilesRef.current && wadFilesRef.current.length)
        ? wadFilesRef.current
        : wadFiles
      for (const f of files) {
        let h = null
        try { h = await getWadFileHash(f) } catch {}
        if (h && h === hash) return f
      }
      return null
    }

    function matchNeedsFolder (match) {
      if (!match) return false
      const pwadHashes = Array.isArray(match.pwadHashes) ? match.pwadHashes : []
      if (pwadHashes.length) return true
      if (match.iwadSource === 'folder') return true
      if (match.iwadHash && !match.iwadSource && !isBundledIwadName(match.iwad)) return true
      return false
    }

    async function resolveMatchWad (match) {
      const wadFilesLive = (wadFilesRef.current && wadFilesRef.current.length)
        ? wadFilesRef.current
        : wadFiles
      const matchIwadHash = match && match.iwadHash ? String(match.iwadHash) : null
      const matchPwadHashes = Array.isArray(match?.pwadHashes) ? match.pwadHashes.map((h) => String(h)) : []
      const matchIwadSource = match && match.iwadSource
        ? String(match.iwadSource)
        : (match && isBundledIwadName(match.iwad) ? 'bundled' : null)
      const hasPerFileHashes = !!matchIwadHash || matchPwadHashes.length > 0
      if (wadDir && (matchNeedsFolder(match) || matchIwadSource === 'folder') && (!wadFilesLive || wadFilesLive.length === 0)) {
        throw new Error('Scanning WAD folder, try again shortly.')
      }

      if (!hasPerFileHashes) {
        const data = await ensureWadData()
        if (match.wadHash && data.hash && match.wadHash !== data.hash) {
          throw new Error('WAD mismatch: your IWAD/PWAD set does not match this match')
        }
        return data
      }

      if (!wadDir && !(matchIwadSource === 'bundled' && matchPwadHashes.length === 0)) {
        throw new Error('WAD/PWAD mismatch: select your WAD folder and retry')
      }

      let resolvedIwad = null
      if (matchIwadSource === 'bundled') {
        const key = getBundledKeyForName(match.iwad)
        if (!key) throw new Error(`Bundled IWAD not available: ${match.iwad}`)
        resolvedIwad = key
      } else {
        const iwadFile = await findWadByHash(matchIwadHash)
        if (!iwadFile) throw new Error('IWAD hash not found in selected folder')
        resolvedIwad = iwadFile.name
      }

      const resolvedPwads = []
      for (const hash of matchPwadHashes) {
        let pwadFile = null
        if (wadDir) {
          try { pwadFile = await findWadByHash(hash) } catch {}
        }
        if (!pwadFile) throw new Error('PWAD hash not found in selected folder')
        resolvedPwads.push(pwadFile.name)
      }

      if (resolvedIwad && resolvedIwad !== selectedIwad) setSelectedIwad(resolvedIwad)
      if (resolvedPwads.length || selectedPwads.length) {
        const same = resolvedPwads.length === selectedPwads.length && resolvedPwads.every((p, i) => p === selectedPwads[i])
        if (!same) setSelectedPwads(resolvedPwads)
      }

      const data = await ensureWadData({ selectedIwad: resolvedIwad, selectedPwads: resolvedPwads })
      if (matchIwadHash && data.iwadHash && matchIwadHash !== data.iwadHash) {
        throw new Error('IWAD hash mismatch after loading')
      }
      if (matchPwadHashes.length) {
        const localHashes = data.pwadHashes || []
        if (localHashes.length !== matchPwadHashes.length) throw new Error('PWAD hash mismatch')
        for (let i = 0; i < matchPwadHashes.length; i++) {
          if (localHashes[i] !== matchPwadHashes[i]) throw new Error('PWAD hash mismatch')
        }
      }
      return data
    }

    function collectMapNames (wadData) {
      const out = new Set()
      if (!wadData) return out
      const entries = [wadData.iwad].concat(wadData.pwads || [])
      for (const entry of entries) {
        if (!entry || !entry.buf) continue
        const names = listWadMapNames(entry.buf)
        if (!names || !names.size) continue
        for (const name of names) out.add(name)
      }
      return out
    }

    function mapExistsInWads (wadData, label) {
      if (!label) return true
      const target = String(label).toUpperCase()
      const maps = collectMapNames(wadData)
      return maps.has(target)
    }


    async function sendChat () {
      const text = sanitizeChat(chatInput)
      if (!text) return
      setChatInput('')
      try {
        const res = await RPC.post('/postChat', { text })
        if (!res || res.ok !== true) {
          const code = res?.error || 'chat_failed'
          if (code === 'chat_disabled') throw new Error('Chat disabled. Ask the admin to enable it.')
          throw new Error(code)
        }
        await loadChatHistory(chatLimit, { force: true })
      } catch (e) {
        setError(String(e?.message || e))
      }
    }

    function toTransferableBuffer (buf) {
      if (!buf) return null
      if (buf instanceof ArrayBuffer) return buf.slice(0)
      if (ArrayBuffer.isView(buf)) {
        return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
      }
      if (typeof Buffer !== 'undefined' && Buffer.isBuffer(buf)) {
        return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
      }
      return null
    }

    async function buildDefaultCfgText (playerName) {
      let cfgBuf = null
      try {
        const baseCfgPath = 'third_party/doom-wasm/src/default.cfg'
        const absBaseCfgPath = path.isAbsolute(baseCfgPath) ? baseCfgPath : (runtimeRoot ? path.join(runtimeRoot, baseCfgPath) : baseCfgPath)
        if (fs && fs.readFileSync) {
          try { cfgBuf = fs.readFileSync(absBaseCfgPath) } catch {}
        }
        if (!cfgBuf) {
          const res = await fetch(baseCfgPath)
          if (res.ok) cfgBuf = new Uint8Array(await res.arrayBuffer())
        }
      } catch {}
      if (!cfgBuf && defaultCfgFallback) cfgBuf = encodeUtf8(defaultCfgFallback)
      if (!cfgBuf) return ''
      let cfgText = decodeUtf8(cfgBuf)
      if (!noSound) {
        if (audioSampleRateFromEnv) cfgText = upsertCfgValue(cfgText, 'snd_samplerate', audioSampleRate, { onlyIfMissing: false })
        if (audioSliceMsFromEnv) cfgText = upsertCfgValue(cfgText, 'snd_maxslicetime_ms', audioSliceMs, { onlyIfMissing: false })
        if (audioChannelsFromEnv) cfgText = upsertCfgValue(cfgText, 'snd_channels', audioChannels, { onlyIfMissing: false })
      }
      if (playerName) cfgText = injectPlayerName(cfgText, playerName)
      return cfgText
    }

    function shutdownModuleRuntime (mod) {
      if (!mod) return
      const canvas = canvasRef.current || mod.canvas || mod['canvas'] || null
      try {
        if (typeof globalThis !== 'undefined' && typeof globalThis.ABORT !== 'undefined') {
          globalThis.ABORT = true
        }
      } catch {}
      try {
        if (typeof mod.pauseMainLoop === 'function') mod.pauseMainLoop()
      } catch {}
      try {
        if (typeof mod.emscripten_cancel_main_loop === 'function') mod.emscripten_cancel_main_loop()
      } catch {}
      try {
        if (typeof mod._emscripten_cancel_main_loop === 'function') mod._emscripten_cancel_main_loop()
      } catch {}
      try {
        if (globalThis.Browser && globalThis.Browser.mainLoop) {
          globalThis.Browser.mainLoop.running = false
          globalThis.Browser.mainLoop.func = null
          if (Array.isArray(globalThis.Browser.mainLoop.queue)) globalThis.Browser.mainLoop.queue.length = 0
        }
      } catch {}
      try {
        const jsEvents = globalThis.JSEvents
        if (jsEvents) {
          if (canvas && typeof jsEvents.removeAllHandlersOnTarget === 'function') {
            jsEvents.removeAllHandlersOnTarget(canvas)
          }
          if (typeof jsEvents.removeAllEventListeners === 'function') {
            jsEvents.removeAllEventListeners()
          }
        }
      } catch {}
      try {
        const SDL2 = mod.SDL2 || mod['SDL2']
        if (SDL2) {
          if (SDL2.audio && SDL2.audio.scriptProcessorNode) {
            try { SDL2.audio.scriptProcessorNode.onaudioprocess = null } catch {}
            try { SDL2.audio.scriptProcessorNode.disconnect() } catch {}
            SDL2.audio.scriptProcessorNode = undefined
          }
          if (SDL2.capture) {
            if (SDL2.capture.scriptProcessorNode) {
              try { SDL2.capture.scriptProcessorNode.onaudioprocess = null } catch {}
              try { SDL2.capture.scriptProcessorNode.disconnect() } catch {}
              SDL2.capture.scriptProcessorNode = undefined
            }
            if (SDL2.capture.mediaStreamNode) {
              try { SDL2.capture.mediaStreamNode.disconnect() } catch {}
              SDL2.capture.mediaStreamNode = undefined
            }
            if (SDL2.capture.stream && typeof SDL2.capture.stream.getAudioTracks === 'function') {
              try {
                const tracks = SDL2.capture.stream.getAudioTracks()
                for (const t of tracks) SDL2.capture.stream.removeTrack(t)
              } catch {}
            }
            if (SDL2.capture.silenceTimer) {
              try { clearTimeout(SDL2.capture.silenceTimer) } catch {}
              SDL2.capture.silenceTimer = undefined
            }
            SDL2.capture = undefined
          }
          SDL2.audio = undefined
          if (SDL2.audioContext && SDL2.audioContext !== audioCtxRef.current) {
            try { SDL2.audioContext.close() } catch {}
          }
        }
      } catch {}
      try { mod.SDL2 = undefined } catch {}
      try { mod.ctx = null } catch {}
      try { mod.GLctx = null } catch {}
    }

    async function cleanupDoomRuntime () {
      const runtime = doomRuntimeRef.current
      disableRuntimeTimerTracking()
      const currentModule = runtime.module || (typeof window !== 'undefined' ? window.Module : null)
      shutdownModuleRuntime(currentModule)
      runtime.running = false
      if (runtime.script && runtime.script.el) {
        try { runtime.script.el.remove() } catch {}
      }
      runtime.module = null
      runtime.script = null
      runtime.frame = null
      try {
        if (window && window.Module === currentModule) window.Module = {}
      } catch {}
      const canvas = canvasRef.current
      if (canvas && canvas.parentNode) {
        const clone = canvas.cloneNode(true)
        canvas.parentNode.replaceChild(clone, canvas)
        canvasRef.current = clone
      }
    }

    async function endMatch ({ reason = 'ended', silent = false, removeMatchEntry = true } = {}) {
      if (endingMatchRef.current) return
      endingMatchRef.current = true
      const match = currentMatchRef.current
      if (!match || !match.gid) {
        await cleanupDoomRuntime()
        setStage('lobby')
        endingMatchRef.current = false
        return
      }
      const gid = match.gid
      const isHost = match.host === peer.wallet.publicKey
      const liveMatch = matchesRef.current.get(gid) || match
      const leavingBeforeStart = !isHost && (liveMatch.status !== 'in_game')
      if (leavingBeforeStart) {
        try { sendMeta({ t: 'match-leave', gid, from: peer.wallet.publicKey }) } catch {}
      }
      if (isHost && !silent) {
        const canEnd = await isGameActiveForHost(gid)
        if (canEnd) {
          try { await peer.protocol_instance.api.endGame(gid) } catch {}
        }
        try { sendMeta({ t: 'match-end', gid, status: 'ended', reason, endedAt: Date.now() }) } catch {}
      }
      if (removeMatchEntry) removeMatch(gid)
      rosterRef.current.delete(gid)
      setCurrentMatch(null)
      setPendingJoin(null)
      startedBroadcastRef.current = null
      if (gameStartedRef.current === gid) gameStartedRef.current = null
      setStatus('')
      await cleanupDoomRuntime()
      setStage('lobby')
      endingMatchRef.current = false
      reloadAppSoon()
    }

    async function retryMatch () {
      reloadAppSoon()
    }

    async function createMatch () {
      setError('')
      try {
        if (wadError) throw new Error(wadError)
        const wadData = await ensureWadData()
        let mapValue = typeof mapInput === 'string' ? mapInput : ''
        mapValue = mapValue.trim().toUpperCase()
        if (mapValue && mapOptions && mapOptions.length) {
          const allowed = new Set(mapOptions.map((opt) => {
            if (typeof opt === 'string') return String(opt).toUpperCase()
            return opt && opt.value ? String(opt.value).toUpperCase() : ''
          }).filter(Boolean))
          if (allowed.size && !allowed.has(mapValue)) {
            mapValue = ''
            setMapInput('')
            setMapError('')
          }
        }
        const warp = parseWarpInput(mapValue)
        if (mapValue && warp.error) throw new Error('Invalid map selection')
        if (warp.label && !mapExistsInWads(wadData, warp.label)) {
          throw new Error(`Map not found in IWAD/PWAD set: ${warp.label}`)
        }
        const gid = `doom-${peer.wallet.publicKey.slice(0, 8)}-${Date.now()}`
        let prevGid = null
        try {
          const prevRec = await peer.base.view.get('server_active/' + peer.wallet.publicKey)
          if (prevRec && typeof prevRec.value === 'string' && prevRec.value) {
            prevGid = prevRec.value
          }
        } catch {}
        if (prevGid && prevGid !== gid) {
          try { await peer.protocol_instance.api.endGame(prevGid) } catch {}
          try { sendMeta({ t: 'match-end', gid: prevGid, status: 'ended', reason: 'override', endedAt: Date.now() }) } catch {}
          removeMatch(prevGid)
          rosterRef.current.delete(prevGid)
        }
        const hostNick = sanitizeNick(nick)
        const mode = normalizeGameMode(gameMode)
        const skillValue = clampSkill(skill, DEFAULT_SKILL)
        const match = {
          gid,
          host: peer.wallet.publicKey,
          hostNick: hostNick || null,
          mode,
          skill: skillValue,
          noMonsters: !!noMonsters && (mode === 'deathmatch' || mode === 'altdeath'),
          maxPlayers: String(clampPlayers(maxPlayers, DEFAULT_PLAYERS)),
          wadHash: wadData.hash,
          iwad: sanitizeFilename(wadData.iwad.name) || wadData.iwad.name,
          iwadHash: wadData.iwadHash || null,
          iwadSource: wadData.iwadSource || null,
          pwads: wadData.pwads.map((p) => sanitizeFilename(p.name) || p.name),
          pwadHashes: Array.isArray(wadData.pwadHashes) ? wadData.pwadHashes : [],
          warp: warp.label || null,
          status: 'open',
          createdAt: Date.now(),
          players: [peer.wallet.publicKey]
        }
        rosterRef.current.set(gid, new Set(match.players))
        setCurrentMatch(match)
        upsertMatch(match)
        sendMeta({ t: 'match-announce', ...match })
        await startDoom(true, match)
      } catch (e) {
        setError(String(e?.message || e))
      }
    }

    async function requestJoin (match) {
      setError('')
      try {
        if (!match || !match.gid) throw new Error('Invalid match')
        const wadData = await resolveMatchWad(match)
        setPendingJoin({ gid: match.gid, ts: Date.now() })
        const joinGid = match.gid
        setTimeoutUntracked(() => {
          if (pendingJoinRef.current && pendingJoinRef.current.gid === joinGid) {
            setPendingJoin(null)
            setStatus('')
            setError('Join request timed out. Try again.')
          }
        }, pendingJoinTimeoutMs)
        sendMeta({
          t: 'match-join',
          gid: match.gid,
          from: peer.wallet.publicKey,
          nick: sanitizeNick(nick) || null,
          wadHash: wadData.hash,
          iwadHash: wadData.iwadHash || null,
          pwadHashes: Array.isArray(wadData.pwadHashes) ? wadData.pwadHashes : [],
          iwad: wadData.iwad.name,
          pwads: wadData.pwads.map((p) => p.name),
          clientId: clientIdRef.current
        })
        sendMeta({
          t: 'match-join-local',
          gid: match.gid,
          matchTopic: match.matchTopic || null
        })
        setStatus('Requesting to join match...')
      } catch (e) {
        setError(String(e?.message || e))
      }
    }

    async function startDoom (isHost, match) {
      setError('')
      setStatus('Initializing Doom...')
      try {
        if (doomRuntimeRef.current.running || doomRuntimeRef.current.script) {
          await cleanupDoomRuntime()
        }
        enableRuntimeTimerTracking()
        if (!noSound) primeAudioContext()
        if (typeof SharedArrayBuffer === 'undefined') {
          setError('SharedArrayBuffer is not available. The UI needs WebAssembly threads (AudioWorklet). Ensure Pear enables SharedArrayBuffer/WebAssemblyThreads.')
          return
        }
        try {
          const mem = new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true })
          if (!(mem.buffer instanceof SharedArrayBuffer)) throw new Error('Shared memory not supported')
        } catch (e) {
          setError('WebAssembly threads are not available. Ensure Pear enables SharedArrayBuffer/WebAssemblyThreads.')
          return
        }
        const matchInfo = match || {}
        const gameId = matchInfo.gid || (isHost ? `doom-${peer.wallet.publicKey.slice(0, 8)}-${Date.now()}` : null)
        startedBroadcastRef.current = null
        gameStartedRef.current = null
        const hostModeValue = normalizeGameMode(matchInfo.mode || gameMode)
        const hostSkillValue = clampSkill(
          (matchInfo.skill != null) ? parseInt(matchInfo.skill, 10) : skill,
          DEFAULT_SKILL
        )
        const hostNoMonstersValue = (typeof matchInfo.noMonsters === 'boolean')
          ? matchInfo.noMonsters
          : (!!noMonsters && (hostModeValue === 'deathmatch' || hostModeValue === 'altdeath'))
        const maxPlayersValue = String(clampPlayers(
          matchInfo.maxPlayers ? parseInt(matchInfo.maxPlayers, 10) : maxPlayers,
          DEFAULT_PLAYERS
        ))
        const warp = parseWarpInput(matchInfo.warp || mapInput)
        if ((matchInfo.warp || mapInput) && warp.error) {
          setError('Invalid map selection')
          return
        }
        const hasMatchWad = !!(matchInfo && (matchInfo.iwadHash || (Array.isArray(matchInfo.pwadHashes) && matchInfo.pwadHashes.length) || matchInfo.wadHash))
        const wadData = hasMatchWad ? await resolveMatchWad(matchInfo) : await ensureWadData()
        if (warp.label && !mapExistsInWads(wadData, warp.label)) {
          setError(`Map not found in IWAD/PWAD set: ${warp.label}`)
          return
        }
        const matchIwadHash = matchInfo && matchInfo.iwadHash ? String(matchInfo.iwadHash) : null
        const matchPwadHashes = Array.isArray(matchInfo?.pwadHashes) ? matchInfo.pwadHashes.map((h) => String(h)) : []
        if (matchIwadHash && wadData.iwadHash && matchIwadHash !== wadData.iwadHash) {
          setError('IWAD mismatch for this match')
          return
        }
        if (matchPwadHashes.length) {
          const localHashes = wadData.pwadHashes || []
          if (localHashes.length !== matchPwadHashes.length) {
            setError('PWAD mismatch for this match')
            return
          }
          for (let i = 0; i < matchPwadHashes.length; i++) {
            if (localHashes[i] !== matchPwadHashes[i]) {
              setError('PWAD mismatch for this match')
              return
            }
          }
        } else if (matchInfo.wadHash && wadData.hash && matchInfo.wadHash !== wadData.hash) {
          setError('WAD mismatch for this match')
          return
        }

        // Prefer Node's WebSocket in Pear (renderer fetch/ws are blocked).
        try {
          const NodeWS = await ensureNodeWebSocket()
          if (NodeWS) globalThis.WebSocket = NodeWS
        } catch {}

        const dnetPort = (peer && typeof peer.dnetPort === 'number') ? peer.dnetPort : dnetPortEnv

        // Reuse the lobby meta WS for identity/gid announcements (avoid extra sockets)
        try {
          const isServer = !!isHost
          const uid = isServer ? 1 : null
          sendMeta({ t: 'hello', isServer, uid })
          if (gameId) sendMeta({ t: 'gid', gid: gameId })
          if (isHost && gameId) {
            sendMeta({ t: 'mode', gid: gameId, mode: hostModeValue, noMonsters: hostNoMonstersValue })
          }
          sendMeta({
            t: 'mhello',
            uid: (uid == null ? 0 : uid),
            address: peer.wallet.publicKey,
            nick: sanitizeNick(nick) || null
          })
        } catch {}
        if (!isHost && gameId) {
          setStatus('Waiting for match swarm connection...')
          const ready = await waitForMatchSwarmReady(gameId, { timeoutMs: matchSwarmWaitMs })
          if (!ready) {
            setError('Match swarm connection timed out. Try rejoin.')
            setStatus('')
            return
          }
          setStatus('Initializing Doom...')
        }
        // If hosting, announce the game strictly on-chain
        if (isHost && gameId) {
          try {
            await peer.protocol_instance.api.startGame(gameId, hostModeValue, parseInt(maxPlayersValue, 10))
            void waitForGameReady(gameId, peer.wallet.publicKey).then((ready) => {
              if (ready) gameStartedRef.current = gameId
            })
          } catch (e) {
            setError('Failed to start game on-chain: ' + String(e))
            return
          }
        }
        const playerName = sanitizeNick(nick)

        // Prepare Module for emscripten bundle
        const canvas = canvasRef.current || document.getElementById('canvas')
        if (canvas) {
          try { canvas.tabIndex = 1 } catch {}
          try { setTimeout(() => { try { canvas.focus() } catch {} }, 0) } catch {}
        }
        const iwadName = wadData.iwad.name
        const iwadBuf = wadData.iwad.buf
        const pwadEntries = wadData.pwads || []
        const forceHost = env.TRAC_FORCE_DNET_HOST ? String(env.TRAC_FORCE_DNET_HOST) : null
        const forcePortEnv = env.TRAC_FORCE_DNET_PORT ? parseInt(env.TRAC_FORCE_DNET_PORT) : null
        const targetHost = forceHost || '127.0.0.1'
        const initialPort = (forcePortEnv != null) ? forcePortEnv : dnetPort
        const resolvedDnetPort = initialPort
        const wssHost = targetHost

        const cfgPath = '/default.cfg'
        let startedBroadcast = false
        async function audioCanAutoplay () {
          if (noSound) return true
          if (!audioCtxRef.current) return false
          try {
            if (audioCtxRef.current.state === 'suspended') {
              const p = audioCtxRef.current.resume()
              if (p && typeof p.then === 'function') {
                await Promise.race([p, sleep(250)])
              }
            }
            return audioCtxRef.current.state === 'running'
          } catch {
            return false
          }
        }
        const audioUnlockRef = { current: false }
        function installAudioUnlockHandlers () {
          if (audioUnlockRef.current) return
          audioUnlockRef.current = true
          const handler = async () => {
            const ok = await audioCanAutoplay()
            if (!ok) return
            remove()
          }
          const targets = [document, canvas].filter(Boolean)
          const remove = () => {
            if (!audioUnlockRef.current) return
            audioUnlockRef.current = false
            for (const el of targets) {
              try { el.removeEventListener('mousedown', handler) } catch {}
              try { el.removeEventListener('keydown', handler) } catch {}
              try { el.removeEventListener('touchstart', handler) } catch {}
            }
          }
          for (const el of targets) {
            try { el.addEventListener('mousedown', handler) } catch {}
            try { el.addEventListener('keydown', handler) } catch {}
            try { el.addEventListener('touchstart', handler) } catch {}
          }
        }
        function waitForAudioGesture (timeoutMs) {
          return new Promise((resolve) => {
            let done = false
            let timer = null
            const finish = (ok) => {
              if (done) return
              done = true
              if (timer) clearTimeout(timer)
              for (const el of targets) {
                try { el.removeEventListener('mousedown', handler) } catch {}
                try { el.removeEventListener('keydown', handler) } catch {}
                try { el.removeEventListener('touchstart', handler) } catch {}
              }
              resolve(ok)
            }
            const handler = async () => {
              const ok = await audioCanAutoplay()
              finish(ok)
            }
            const targets = [document, canvas].filter(Boolean)
            for (const el of targets) {
              try { el.addEventListener('mousedown', handler, { once: true }) } catch {}
              try { el.addEventListener('keydown', handler, { once: true }) } catch {}
              try { el.addEventListener('touchstart', handler, { once: true }) } catch {}
            }
            if (timeoutMs > 0) timer = setTimeout(() => finish(false), timeoutMs)
          })
        }
        let Module = {
          onRuntimeInitialized: () => {
            ;(async () => {
              const args = [
                '-iwad', iwadName,
                '-window',
                '-config', cfgPath,
                '-wss', `ws://${wssHost}:${resolvedDnetPort}/doom`
              ]
              let disableSound = noSound
              let disableMusic = noMusic
              if (!disableSound && audioCtxRef.current) {
                Module.SDL2 = Module.SDL2 || {}
                Module.SDL2.audioContext = audioCtxRef.current
                Module.SDL2.audio = Module.SDL2.audio || {}
                Module.SDL2.capture = Module.SDL2.capture || {}
              }
              if (!disableSound && audioPreflightMs > 0) {
                const ok = await audioPreflight()
                if (!ok && audioStrict) {
                  disableSound = true
                  setStatus('Audio init failed; starting without sound.')
                }
              }
              if (!disableSound) {
                const canAuto = await audioCanAutoplay()
                if (!canAuto) {
                  setStatus('Click to enable audio…')
                  installAudioUnlockHandlers()
                  if (audioWaitMs > 0) {
                    const unlocked = await waitForAudioGesture(audioWaitMs)
                    if (!unlocked && audioStrict) disableSound = true
                  }
                }
              }
              if (disableSound) {
                args.push('-nosound')
              } else if (disableMusic) {
                args.push('-nomusic')
              }
              if (pwadEntries.length) {
                args.push('-file')
                for (const pw of pwadEntries) args.push(pw.name)
              }
              if (playerName) args.push('-pet', playerName)
              if (peer && peer.wallet && peer.wallet.publicKey) {
                args.push('-tracaddr', peer.wallet.publicKey)
                if (playerName) args.push('-tracnick', playerName)
              }
              if (isHost) {
                args.push('-server')
                args.push('-players', maxPlayersValue)
                if (hostModeValue === 'deathmatch') args.push('-deathmatch')
                if (hostModeValue === 'altdeath') args.push('-altdeath')
                if (hostNoMonstersValue) args.push('-nomonsters')
                args.push('-skill', String(hostSkillValue))
                if (warp.args && warp.args.length) args.push(...warp.args)
              } else {
                args.push('-connect', '1')
              }
              if (isHost && gameId) {
                upsertMatch({ gid: gameId, status: 'starting' })
                sendMeta({ t: 'match-update', gid: gameId, status: 'starting' })
              }
              callMain(args)
              try {
                setTimeout(() => {
                  try { canvas && canvas.focus() } catch {}
                  if (!isHost) {
                    const down = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true })
                    const up = new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true })
                    try { window.dispatchEvent(down) } catch {}
                    setTimeout(() => { try { window.dispatchEvent(up) } catch {} }, 50)
                  }
                }, 1200)
              } catch {}
              try { setStage('running') } catch {}
              resizeCanvasToWrap()
            })().catch((e) => {
              setError(String(e?.message || e))
            })
          },
          noInitialRun: true,
          locateFile: (p) => {
            if (!p) return p
            if (p.includes('third_party/doom-wasm/src/')) return resolveAssetUrl(p)
            return resolveAssetUrl(`third_party/doom-wasm/src/${p}`)
          },
          preRun: [function () {
            Module.FS_createDataFile('/', iwadName, iwadBuf, true, true)
            for (const pw of pwadEntries) {
              try { Module.FS_createDataFile('/', pw.name, pw.buf, true, true) } catch {}
            }
            try {
              let cfgBuf
              if (fs && fs.readFileSync) {
                const baseCfgPath = 'third_party/doom-wasm/src/default.cfg'
                const absBaseCfgPath = path.isAbsolute(baseCfgPath) ? baseCfgPath : (runtimeRoot ? path.join(runtimeRoot, baseCfgPath) : baseCfgPath)
                try { cfgBuf = fs.readFileSync(absBaseCfgPath) } catch {}
              }
              if (!cfgBuf && defaultCfgFallback) {
                cfgBuf = encodeUtf8(defaultCfgFallback)
              }
              if (cfgBuf) {
                let cfgText = decodeUtf8(cfgBuf)
                if (!noSound) {
                  if (audioSampleRateFromEnv) cfgText = upsertCfgValue(cfgText, 'snd_samplerate', audioSampleRate, { onlyIfMissing: false })
                  if (audioSliceMsFromEnv) cfgText = upsertCfgValue(cfgText, 'snd_maxslicetime_ms', audioSliceMs, { onlyIfMissing: false })
                  if (audioChannelsFromEnv) cfgText = upsertCfgValue(cfgText, 'snd_channels', audioChannels, { onlyIfMissing: false })
                }
                if (playerName) cfgText = injectPlayerName(cfgText, playerName)
                cfgBuf = encodeUtf8(cfgText)
                Module.FS_createDataFile('/', 'default.cfg', cfgBuf, true, true)
              } else if (playerName) {
                const fallback = encodeUtf8(`player_name "${playerName}"
`)
                Module.FS_createDataFile('/', 'default.cfg', fallback, true, true)
              }
            } catch {}
          }],
          print: (t) => {
            console.log(t)
            if (!startedBroadcast && isHost && gameId && typeof t === 'string' && t.includes('doom: 10, game started')) {
              startedBroadcast = true
              startedBroadcastRef.current = gameId
              upsertMatch({ gid: gameId, status: 'in_game' })
              sendMeta({ t: 'match-start', gid: gameId, status: 'in_game' })
            }
          },
          printErr: (t) => console.error(t),
          canvas: canvas,
          setStatus: (t) => setStatus(t || '')
        }
        // Prefer on-disk wasm when available; otherwise let Emscripten fetch from packaged assets.
        let wasmBuf = null
        try {
          if (fs && fs.readFileSync) {
            const wasmPath = 'third_party/doom-wasm/src/websockets-doom.wasm'
            const abs = path.isAbsolute(wasmPath) ? wasmPath : (runtimeRoot ? path.join(runtimeRoot, wasmPath) : wasmPath)
            try { wasmBuf = fs.readFileSync(abs) } catch {}
          }
        } catch {}
        if (wasmBuf) {
          Module.instantiateWasm = function (imports, receiveInstance) {
            try {
              const mod = new WebAssembly.Module(wasmBuf)
              const inst = new WebAssembly.Instance(mod, imports)
              const out = receiveInstance(inst, mod)
              return out || inst.exports
            } catch (e) {
              console.error('[app] wasm instantiate failed:', e?.message || e)
              return false
            }
          }
          Module.wasmBinary = wasmBuf
        }
        window.Module = Module
        doomRuntimeRef.current.running = true
        doomRuntimeRef.current.module = Module
        // meta WS already initialized
        if (gameId) {
          try { sendMeta({ t: 'gid', gid: gameId }) } catch {}
          if (isHost) {
            try { sendMeta({ t: 'mode', gid: gameId, mode: hostModeValue, noMonsters: hostNoMonstersValue }) } catch {}
          }
        }

        const jsPath = 'third_party/doom-wasm/src/websockets-doom.js'
        const jsUrl = resolveAssetUrl(jsPath)
        Module.mainScriptUrlOrBlob = jsUrl || jsPath
        doomRuntimeRef.current.script = loadDoomScript(jsPath, () => setStage('running'), () => {
          setError('Failed to load Doom bundle. Build it first (see README).')
        })
      } catch (e) {
        setError(String(e))
      }
    }

    async function loadScoreboard (modeOverride) {
      setScoreLoading(true)
      setError('')
      try {
        const mode = modeOverride || scoreMode
        const lenRec = await peer.base.view.get('klogl')
        const len = lenRec === null ? 0 : parseInt(lenRec.value)
        const counts = new Map()
        for (let i = 0; i < len; i++) {
          const rec = await peer.base.view.get('klog/' + i)
          if (rec === null) continue
          const v = rec.value
          const entry = (v && typeof v === 'object') ? v : null
          if (!entry || !entry.killer) continue
          const entryMode = entry.mode || 'unknown'
          if (mode === 'all' || entryMode === mode) {
            const k = '' + entry.killer
            counts.set(k, (counts.get(k) || 0) + 1)
          }
        }
        const nickCache = new Map(peerNicks)
        const resolveNick = async (addr) => {
          if (!addr) return null
          if (nickCache.has(addr)) return nickCache.get(addr)
          let n = null
          try { n = await peer.protocol_instance.api.getNick(addr) } catch {}
          if (typeof n === 'string' && n.length) nickCache.set(addr, n)
          return (typeof n === 'string' && n.length) ? n : null
        }
        const entries = Array.from(counts.entries())
        entries.sort((a, b) => b[1] - a[1])
        const topEntries = entries.slice(0, scoreTopLimit)
        const out = []
        for (const [address, count] of topEntries) {
          const n = await resolveNick(address)
          out.push({ address, count, nick: n })
        }
        setScores(out)
      } catch (e) { setError(String(e)) }
      finally {
        setScoreLoading(false)
      }
    }

    async function loadAchievements () {
      setAchLoading(true)
      setError('')
      try {
        const addr = peer && peer.wallet ? peer.wallet.publicKey : null
        if (!addr || !peer.base || !peer.base.view) {
          setAchievements([])
          return
        }
        const listRec = await peer.base.view.get('ach_list/' + addr)
        const list = listRec && Array.isArray(listRec.value) ? listRec.value : []
        if (list.length === 0) {
          setAchievements([])
          return
        }
        const out = []
        for (const id of list) {
          const rec = await peer.base.view.get('ach/' + addr + '/' + id)
          if (!rec || rec.value === null) continue
          const value = rec.value
          const title = value && typeof value.title === 'string' ? value.title : String(id)
          const count = value && value.count !== undefined ? parseInt(value.count) : 1
          out.push({ id, title, count: Number.isFinite(count) ? count : 1 })
        }
        out.sort((a, b) => {
          if (b.count !== a.count) return b.count - a.count
          return a.title.localeCompare(b.title)
        })
        setAchievements(out)
      } catch (e) {
        setError(String(e))
      } finally {
        setAchLoading(false)
      }
    }

    const matchEntries = Array.from(matches.values())
      .filter((m) => m && m.gid && m.status !== 'ended')
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    const presenceEntries = Array.from(presence.values())
      .filter((p) => p && p.address)
      .sort((a, b) => {
        const an = (a.nick || a.address || '').toLowerCase()
        const bn = (b.nick || b.address || '').toLowerCase()
        return an.localeCompare(bn)
      })
    const hasMoreChat = chatTotalRef.current > chatLimit && chatLimit < chatLimitMax
    void matchDebugTick
    const matchDebug = matchDebugRef.current
    const matchSentAgo = matchDebug.sentAt ? Math.round((Date.now() - matchDebug.sentAt) / 1000) : null
    const matchRecvAgo = matchDebug.recvAt ? Math.round((Date.now() - matchDebug.recvAt) / 1000) : null
    const isHostMatch = currentMatch && currentMatch.host === peer.wallet.publicKey

    return html`
      <main className="app-root" data-stage=${stage}>
        <header className="topbar">
          <div className="brand">
            <img className="logo" src="./assets/trac-logo.png" alt="Trac Network" />
            <div className="brand-title">P2P Doom</div>
          </div>
          <div className="stat-stack">
            <div className="stat">Channel <span className="mono">${peer.options.channel}</span></div>
            <div className="stat">Peers <span className="mono">${peers.length}</span></div>
            <div className="stat">Match swarm <span className="mono">${matchSwarmConns}${matchSwarmGid ? ' ' + matchSwarmGid.slice(0, 6) : ''}</span></div>
            <div className="stat">${metaConnected ? 'Lobby online' : 'Lobby offline'}</div>
            <div className="stat">Match announce <span className="mono">sent ${matchSentAgo !== null ? matchSentAgo + 's' : '–'}${matchDebug.sentGid ? ' ' + String(matchDebug.sentGid).slice(0, 6) : ''} · recv ${matchRecvAgo !== null ? matchRecvAgo + 's' : '–'}${matchDebug.recvGid ? ' ' + String(matchDebug.recvGid).slice(0, 6) : ''}</span></div>
          </div>
          <div className="nick-row">
            <input
              value=${nick}
              onInput=${e => setNick(e.target.value)}
              onBlur=${() => saveNick({ value: nick })}
              onKeyDown=${e => { if (e.key === 'Enter') { e.preventDefault(); saveNick({ value: nick }) } }}
              placeholder="nickname"
            />
            <button onClick=${() => saveNick({ value: nick })}>Save</button>
            <span className=${`nick-status ${nickSaving ? 'saving' : (nickDirty ? 'unsaved' : 'saved')}`}>
              ${nickSaving ? 'Saving…' : (nickDirty ? 'Unsaved' : 'Saved')}
            </span>
          </div>
        </header>

        ${stage === 'lobby' && html`
          <section className="layout">
            <aside className="panel players-panel">
              <div className="panel-title">Players</div>
              ${presenceEntries.length === 0 && html`<div className="muted">No presence yet.</div>`}
              ${presenceEntries.length > 0 && html`<div className="list scroll-list">
                ${presenceEntries.map(p => html`<div key=${p.address} className="row">
                  <span>${p.nick || p.address?.slice(0, 8)}</span>
                  <span className="muted">${p.status || 'idle'}${p.matchGid ? ' • ' + p.matchGid.slice(0, 6) : ''}</span>
                </div>`)}
              </div>`}

              <div className="panel-title" style=${{ marginTop: '1rem' }}>Lobby Chat</div>
              <div
                className="chat-box"
                ref=${chatBoxRef}
                onScroll=${(e) => {
                  try {
                    const el = e.currentTarget
                    const nearBottom = (el.scrollTop + el.clientHeight) >= (el.scrollHeight - 24)
                    chatAutoScrollRef.current = nearBottom
                  } catch {}
                }}
              >
                ${chatMessages.length === 0 && html`<div className="muted">No chat yet.</div>`}
                ${chatMessages.map(m => html`<div key=${m.id} className="chat-line">
                  <strong>${m.nick || m.from?.slice(0, 8) || 'anon'}:</strong> ${m.text}
                </div>`)}
              </div>
              <div className="chat-actions">
                <input
                  value=${chatInput}
                  onInput=${e => setChatInput(e.target.value)}
                  placeholder="Say something..."
                  onKeyDown=${e => { if (e.key === 'Enter') sendChat() }}
                />
                <button onClick=${sendChat}>Send</button>
              </div>
              ${hasMoreChat && html`<button className="ghost" onClick=${() => setChatLimit(Math.min(chatLimit + 40, chatLimitMax))}>Load older</button>`}
            </aside>

            <section className="panel matchmaking-panel">
              <div className="panel-title">Matchmaking</div>
              <details className="wad-card">
                <summary className="wad-summary">MAP Settings</summary>
                <div className="wad-body">
                  <div className="row">
                    <span>WAD folder</span>
                    <input
                      className="path-input"
                      value=${wadDirInput}
                      onInput=${e => setWadDirInput(e.target.value)}
                      onBlur=${() => applyWadDir(wadDirInput)}
                      onKeyDown=${e => { if (e.key === 'Enter') { e.preventDefault(); applyWadDir(wadDirInput) } }}
                      placeholder="Paste WAD folder path"
                    />
                  </div>
                  ${wadScanError && html`<div className="error">${wadScanError}</div>`}
                  <div className="wad-section">
                    <div className="muted">IWAD</div>
                    <div className="list scroll-list">
                      ${BUNDLED_IWADS.map((iwad) => html`
                        <label key=${iwad.key} className="row">
                          <span>
                            <input
                              type="radio"
                              name="iwad"
                              checked=${selectedIwad === iwad.key}
                              onChange=${() => setSelectedIwad(iwad.key)}
                            />
                            ${iwad.label}
                          </span>
                          ${iwad.key === DEFAULT_BUNDLED_IWAD_KEY && html`<span className="muted">default</span>`}
                        </label>
                      `)}
                      ${wadFiles.filter((f) => f.kind === 'iwad').map((f) => html`
                        <label key=${f.name} className="row">
                          <span>
                            <input
                              type="radio"
                              name="iwad"
                              checked=${selectedIwad === f.name}
                              onChange=${() => setSelectedIwad(f.name)}
                            />
                            ${f.name}
                          </span>
                          <span className="muted">${Math.round((f.size || 0) / 1024)} KB</span>
                        </label>
                      `)}
                    </div>
                  </div>
                  ${(() => {
                    const pwadOptions = wadFiles
                      .filter((f) => f.kind === 'pwad')
                      .filter((f) => f.name !== selectedIwad)
                    return html`
                  <div className="wad-section">
                    <div className="muted">PWADs</div>
                    <div className="list scroll-list">
                      <label className="row">
                        <span>
                          <input
                            type="checkbox"
                            checked=${selectedPwads.length === 0}
                            onChange=${() => setSelectedPwads([])}
                          />
                          None
                        </span>
                      </label>
                      ${pwadOptions.map((f) => html`
                        <label key=${f.name} className="row">
                          <span>
                            <input
                              type="checkbox"
                              checked=${selectedPwads.includes(f.name)}
                              onChange=${(e) => {
                                const next = new Set(selectedPwads)
                                if (e.target.checked) next.add(f.name)
                                else next.delete(f.name)
                                setSelectedPwads(Array.from(next))
                              }}
                            />
                            ${f.name}
                          </span>
                        </label>
                      `)}
                    </div>
                  </div>
                    `
                  })()}
                  <div className="row">
                    <span>Hash</span>
                    <span className="mono">${wadInfo && wadInfo.hash ? wadInfo.hash.slice(0, 12) + '…' : 'n/a'}</span>
                  </div>
                  ${wadError && html`<div className="error">WAD error: ${wadError}</div>`}
                </div>
              </details>

              <div className="form-grid">
                <label>
                  Mode
                  <select value=${gameMode} onChange=${e => setGameMode(e.target.value)}>
                    <option value="deathmatch">Deathmatch</option>
                    <option value="altdeath">Altdeath</option>
                    <option value="coop">Co-op</option>
                  </select>
                </label>
                <label>
                  Max players
                  <input
                    type="number"
                    min="1"
                    max="4"
                    value=${maxPlayers}
                    onInput=${e => setMaxPlayers(clampPlayers(parseInt(e.target.value, 10), maxPlayers))}
                  />
                </label>
                <label className=${gameMode === 'coop' ? 'disabled' : ''}>
                  <span>
                    <input
                      type="checkbox"
                      checked=${noMonsters}
                      disabled=${gameMode === 'coop'}
                      onChange=${e => setNoMonsters(e.target.checked)}
                    />
                    No monsters
                  </span>
                </label>
                <div className="map-skill-row">
                  <label>
                    Map
                    <select
                      value=${mapInput}
                      onChange=${e => setMapInput(e.target.value)}
                      disabled=${mapOptions.length === 0}
                    >
                      <option value="">Auto (${wadInfo ? mapPlaceholder(wadInfo.iwad) : 'E1M1'})</option>
                      ${mapOptions.map((opt, idx) => {
                        if (typeof opt === 'string') return html`<option key=${opt} value=${opt}>${opt}</option>`
                        const value = opt && opt.value ? opt.value : ''
                        const label = opt && opt.label ? opt.label : value
                        const key = opt && opt.key ? opt.key : `${value}|${label}|${idx}`
                        return html`<option key=${key} value=${value}>${label}</option>`
                      })}
                    </select>
                    ${mapError && html`<div className="muted">${mapError}</div>`}
                  </label>
                  <label>
                    Skill
                    <select
                      value=${skill}
                      onChange=${e => setSkill(clampSkill(parseInt(e.target.value, 10), DEFAULT_SKILL))}
                    >
                      ${SKILL_OPTIONS.map((opt) => html`<option key=${opt.value} value=${opt.value}>${opt.label}</option>`)}
                    </select>
                  </label>
                </div>
              </div>
              <div className="button-row">
                <button onClick=${createMatch} disabled=${!!wadError}>Create match</button>
              </div>

              <div className="panel-title" style=${{ marginTop: '1rem' }}>Matches</div>
              ${matchEntries.length === 0 && html`<div className="muted">${(metaConnected && metaLastMsgAt) ? 'No open matches.' : 'Syncing… waiting for match announcements.'}</div>`}
              ${matchEntries.length > 0 && html`<div className="list scroll-list matches-scroll">
                ${matchEntries.map(m => html`<div key=${m.gid} className="match-row">
                  <div className="match-main">
                    <div>${m.hostNick || m.host?.slice(0, 8)}</div>
                    <div className="muted">${m.mode}${m.noMonsters ? ' • no monsters' : ''} • ${skillLabel(m.skill)} • ${m.warp || 'auto map'}</div>
                    <div className="muted">IWAD ${m.iwad || DEFAULT_BUNDLED_IWAD.name}${(m.pwads && m.pwads.length) ? ' • PWAD ' + m.pwads.join(', ') : ''}</div>
                  </div>
                  <div className="match-meta">
                    <span className="mono">${(m.players && m.players.length) || 1}/${m.maxPlayers || '?'}</span>
                    <span className="muted">${m.status || 'open'}</span>
                  </div>
                  <button onClick=${() => requestJoin(m)} disabled=${pendingJoin && pendingJoin.gid === m.gid || m.status === 'full' || m.status === 'ended'}>Join</button>
                </div>`)}
              </div>`}
            </section>

            <aside className="panel rankings-panel">
              <div className="panel-title">Rankings</div>
              <div className="tabs">
                ${['deathmatch', 'altdeath'].map(mode => {
                  const label = mode === 'deathmatch' ? 'Deathmatch' : 'Altdeath'
                  return html`
                    <button key=${mode} className=${scoreMode === mode ? 'active' : ''} onClick=${() => setScoreMode(mode)}>
                      ${label}
                    </button>
                  `
                })}
              </div>
              <div className="button-row">
                <button className="ghost" onClick=${() => loadScoreboard(scoreMode)} disabled=${scoreLoading}>${scoreLoading ? 'Loading…' : 'Refresh'}</button>
              </div>
              ${scores.length === 0 && html`<div className="muted">No kills recorded yet.</div>`}
              ${scores.length > 0 && html`<div className="list scroll-list">
                ${scores.map(s => html`<div key=${s.address} className="row">
                  <span>${s.nick || s.address.slice(0, 8)}</span>
                  <span className="mono">${s.count}</span>
                </div>`)}
              </div>`}

              <div className="panel-title" style=${{ marginTop: '1rem' }}>Achievements</div>
              <div className="button-row">
                <button className="ghost" onClick=${() => loadAchievements()} disabled=${achLoading}>${achLoading ? 'Loading…' : 'Refresh'}</button>
              </div>
              ${achievements.length === 0 && html`<div className="muted">No achievements yet.</div>`}
              ${achievements.length > 0 && html`<div className="list scroll-list">
                ${achievements.map(a => html`<div key=${a.id} className="row">
                  <span>${a.title}</span>
                  <span className="mono">${a.count > 1 ? 'x' + a.count : ''}</span>
                </div>`)}
              </div>`}
            </aside>
          </section>
        `}

        ${stage === 'lobby' && status && html`<div className="banner">${status}</div>`}
        ${stage === 'lobby' && error && html`<div className="banner error">${error}</div>`}

        <section className="game-shell" data-active=${stage === 'running' ? '1' : '0'}>
          <div className="game-head">
            <div>
              <div className="game-title">${currentMatch ? `Match ${currentMatch.gid.slice(0, 8)}` : 'Match running'}</div>
              ${currentMatch && html`<div className="muted">${currentMatch.mode || 'deathmatch'} • ${skillLabel(currentMatch.skill)} • ${currentMatch.warp || 'auto map'}</div>`}
            </div>
            <div className="button-row">
              ${error && html`<button className="ghost" onClick=${retryMatch}>Retry</button>`}
              <button onClick=${() => endMatch({ reason: isHostMatch ? 'host_end' : 'left', removeMatchEntry: isHostMatch })}>
                ${isHostMatch ? 'End match' : 'Leave match'}
              </button>
            </div>
          </div>
          ${status && html`<div className="banner">${status}</div>`}
          ${error && html`<div className="banner error">${error}</div>`}
          <div className="canvas-wrap" ref=${canvasWrapRef}>
            <canvas className="frame" id="canvas" ref=${canvasRef}></canvas>
          </div>
        </section>
      </main>
    `
  }

  const root = createRoot(document.querySelector('#root'))
  root.render(html`<${DoomApp} />`)
}

main().catch(err => console.error('[app] init failed', err))

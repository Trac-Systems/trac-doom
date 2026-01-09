import net from 'node:net'
import crypto from 'node:crypto'
import { WebSocket } from 'ws'
import { Wallet } from 'trac-peer'
import { attachDoomWSBridge } from '../src/doom/ws-bridge.js'

function hex (n = 32) { return crypto.randomBytes(n).toString('hex') }

class FakeSwarm {
  constructor () {
    this.connections = new Set()
    this._listeners = new Set()
  }
  on (event, fn) {
    if (event === 'connection') this._listeners.add(fn)
  }
  join () {}
  flush () {}
  destroy () {}
  addConnection (conn) {
    this.connections.add(conn)
    for (const fn of this._listeners) {
      try { fn(conn) } catch {}
    }
  }
}

async function makeLinkedPair () {
  const server = net.createServer()
  await new Promise((resolve) => server.listen(0, resolve))
  const port = server.address().port
  const client = net.connect({ port })
  const srvSock = await new Promise((resolve) => server.once('connection', resolve))
  server.close()
  return [client, srvSock]
}

async function connectPeers (peerA, peerB) {
  const [connA, connB] = await makeLinkedPair()
  peerA.swarm.addConnection(connA)
  peerB.swarm.addConnection(connB)
  return [connA, connB]
}

async function connectSwarms (swarmA, swarmB) {
  const [connA, connB] = await makeLinkedPair()
  swarmA.addConnection(connA)
  swarmB.addConnection(connB)
  return [connA, connB]
}

async function makePeer () {
  const wallet = new Wallet()
  await wallet.generateKeyPair()
  const store = new Map()
  const base = {
    isIndexer: false,
    view: {
      get: async (key) => (store.has(key) ? { value: store.get(key) } : null)
    }
  }
  const protocol_instance = {
    api: {
      getNick: async () => null,
      recordKillStrict: async () => {},
      joinGame: async (gid, uid) => {
        store.set(`game/${gid}/roster/${uid}`, wallet.publicKey)
        store.set(`game/${gid}/roster_active/${uid}`, 1)
        store.set(`game/${gid}/active`, 1)
      }
    }
  }
  return { swarm: new FakeSwarm(), wallet, base, protocol_instance, options: { channel: 'e2e' }, _store: store }
}

function seedRoster (peers, gid, uid, addr) {
  for (const peer of peers) {
    peer._store.set(`game/${gid}/roster/${uid}`, addr)
    peer._store.set(`game/${gid}/roster_active/${uid}`, 1)
    peer._store.set(`game/${gid}/active`, 1)
  }
}

async function getFreePort () {
  const server = net.createServer()
  await new Promise((resolve) => server.listen(0, resolve))
  const port = server.address().port
  await new Promise((resolve) => server.close(resolve))
  return port
}

async function waitListening (server) {
  if (!server) throw new Error('WS bridge server missing')
  if (server.listening) return
  await new Promise((resolve) => server.once('listening', resolve))
}

async function wsOpen (url) {
  const ws = new WebSocket(url)
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout opening ${url}`)), 2000)
    ws.on('open', () => { clearTimeout(timer); resolve() })
    ws.on('error', (err) => { clearTimeout(timer); reject(err) })
  })
  return ws
}

async function waitFor (fn, timeoutMs) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (fn()) return true
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return false
}

function makePacket (to, from, payload) {
  const payloadBytes = (typeof payload === 'string') ? new TextEncoder().encode(payload) : payload
  const out = new Uint8Array(8 + payloadBytes.length)
  const dv = new DataView(out.buffer)
  dv.setUint32(0, to >>> 0, true)
  dv.setUint32(4, from >>> 0, true)
  out.set(payloadBytes, 8)
  return out
}

function toU8 (data) {
  if (data instanceof Uint8Array) return data
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  return new Uint8Array(data)
}

function parsePacket (data) {
  const u8 = toU8(data)
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength)
  return { from: dv.getUint32(0, true), payload: u8.subarray(4) }
}

async function collectPackets (ws, count, timeoutMs) {
  return await new Promise((resolve, reject) => {
    const packets = []
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error(`timeout waiting for ${count} packets`))
    }, timeoutMs)
    const onMessage = (data) => {
      packets.push(parsePacket(data))
      if (packets.length >= count) {
        cleanup()
        resolve(packets)
      }
    }
    const cleanup = () => {
      clearTimeout(timer)
      ws.removeListener('message', onMessage)
    }
    ws.on('message', onMessage)
  })
}

async function main () {
  const gid = `doom-direct-${Date.now()}`
  const host = await makePeer()
  const joiner = await makePeer()
  host._createMatchSwarm = () => new FakeSwarm()
  joiner._createMatchSwarm = () => new FakeSwarm()

  await connectPeers(host, joiner)

  const hostServer = attachDoomWSBridge(host, { host: '127.0.0.1', port: await getFreePort() })
  const joinerServer = attachDoomWSBridge(joiner, { host: '127.0.0.1', port: await getFreePort() })
  await Promise.all([waitListening(hostServer), waitListening(joinerServer)])

  const hostPort = hostServer.address().port
  const joinerPort = joinerServer.address().port

  const hostMeta = await wsOpen(`ws://127.0.0.1:${hostPort}/meta`)
  hostMeta.send(JSON.stringify({ t: 'gid', gid }))
  hostMeta.send(JSON.stringify({ t: 'match-announce', gid, host: host.wallet.publicKey, status: 'open', maxPlayers: '2', players: [host.wallet.publicKey] }))
  const joinerMeta = await wsOpen(`ws://127.0.0.1:${joinerPort}/meta`)
  joinerMeta.send(JSON.stringify({ t: 'gid', gid }))

  const hostSwarmReady = await waitFor(() => !!host._matchSwarm, 2000)
  if (!hostSwarmReady) throw new Error('host match swarm not created')
  hostMeta.send(JSON.stringify({ t: 'match-accept', gid, to: joiner.wallet.publicKey }))
  const joinerSwarmReady = await waitFor(() => !!joiner._matchSwarm, 2000)
  if (!joinerSwarmReady) throw new Error('joiner match swarm not created')
  await connectSwarms(host._matchSwarm, joiner._matchSwarm)
  await new Promise((resolve) => setTimeout(resolve, 100))

  const hostReady = await waitFor(() => host._wsInfo && host._wsInfo().games.includes(gid), 2000)
  const joinerReady = await waitFor(() => joiner._wsInfo && joiner._wsInfo().games.includes(gid), 2000)
  if (!hostReady || !joinerReady) throw new Error('gid was not registered before test')

  const hostDoom = await wsOpen(`ws://127.0.0.1:${hostPort}/doom`)
  const joinerDoom = await wsOpen(`ws://127.0.0.1:${joinerPort}/doom`)

  const uid = 3333
  seedRoster([host, joiner], gid, 1, host.wallet.publicKey)
  seedRoster([host, joiner], gid, uid, joiner.wallet.publicKey)
  joinerDoom.send(makePacket(1, uid, 'hello'))

  const [hostPkt] = await collectPackets(hostDoom, 1, 2000)
  if (hostPkt.from !== uid) throw new Error('host did not receive joiner packet')

  const joinerPktPromise = collectPackets(joinerDoom, 1, 2000)
  hostDoom.send(makePacket(uid, 1, 'ack'))
  const [joinerPkt] = await joinerPktPromise
  if (joinerPkt.from !== 1) throw new Error('joiner did not receive host packet')

  console.log('OK: ws-bridge direct delivers packets.')

  for (const ws of [hostMeta, joinerMeta, hostDoom, joinerDoom]) {
    try { ws.close() } catch {}
  }
  for (const srv of [hostServer, joinerServer]) {
    try { srv.close() } catch {}
  }
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

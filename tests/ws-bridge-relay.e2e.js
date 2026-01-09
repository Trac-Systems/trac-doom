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

async function makeLinkedMuxPair () {
  const server = net.createServer()
  await new Promise((resolve) => server.listen(0, resolve))
  const port = server.address().port
  const client = net.connect({ port })
  const srvSock = await new Promise((resolve) => server.once('connection', resolve))
  server.close()
  return [client, srvSock]
}

async function connectPeers (peerA, peerB) {
  const [connA, connB] = await makeLinkedMuxPair()
  peerA.swarm.addConnection(connA)
  peerB.swarm.addConnection(connB)
  return [connA, connB]
}

async function connectSwarms (swarmA, swarmB) {
  const [connA, connB] = await makeLinkedMuxPair()
  swarmA.addConnection(connA)
  swarmB.addConnection(connB)
  return [connA, connB]
}

async function makePeer ({ isIndexer = false, channel = 'e2e' } = {}) {
  const wallet = new Wallet()
  await wallet.generateKeyPair()
  const store = new Map()
  const base = {
    isIndexer,
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
  return { swarm: new FakeSwarm(), wallet, base, protocol_instance, options: { channel }, _store: store }
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

function toU8 (data) {
  if (data instanceof Uint8Array) return data
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  return new Uint8Array(data)
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

function parsePacket (data) {
  const u8 = toU8(data)
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength)
  const from = dv.getUint32(0, true)
  const payload = u8.subarray(4)
  return { from, payload }
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

async function waitForPacket (ws, predicate, timeoutMs) {
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('timeout waiting for packet'))
    }, timeoutMs)
    const onMessage = (data) => {
      try {
        const pkt = parsePacket(data)
        if (predicate(pkt)) {
          cleanup()
          resolve(pkt)
        }
      } catch {}
    }
    const cleanup = () => {
      clearTimeout(timer)
      ws.removeListener('message', onMessage)
    }
    ws.on('message', onMessage)
  })
}

async function main () {
  const gid = `doom-e2e-${Date.now()}`
  const indexer = await makePeer({ isIndexer: true, channel: 'e2e' })
  const host = await makePeer({ channel: 'e2e' })
  const joinerA = await makePeer({ channel: 'e2e' })
  const joinerB = await makePeer({ channel: 'e2e' })
  host._createMatchSwarm = () => new FakeSwarm()
  joinerA._createMatchSwarm = () => new FakeSwarm()
  joinerB._createMatchSwarm = () => new FakeSwarm()

  await connectPeers(host, indexer)
  await connectPeers(joinerA, indexer)
  await connectPeers(joinerB, indexer)

  if (host.swarm.connections.size !== 1) throw new Error('host swarm missing connection')
  if (joinerA.swarm.connections.size !== 1) throw new Error('joinerA swarm missing connection')
  if (joinerB.swarm.connections.size !== 1) throw new Error('joinerB swarm missing connection')
  if (indexer.swarm.connections.size !== 3) throw new Error('indexer swarm missing connections')

  const hostServer = attachDoomWSBridge(host, { host: '127.0.0.1', port: await getFreePort() })
  const indexerServer = attachDoomWSBridge(indexer, { host: '127.0.0.1', port: await getFreePort() })
  const joinerAServer = attachDoomWSBridge(joinerA, { host: '127.0.0.1', port: await getFreePort() })
  const joinerBServer = attachDoomWSBridge(joinerB, { host: '127.0.0.1', port: await getFreePort() })

  await Promise.all([waitListening(hostServer), waitListening(indexerServer), waitListening(joinerAServer), waitListening(joinerBServer)])

  const hostPort = hostServer.address().port
  const indexerPort = indexerServer.address().port
  const joinerAPort = joinerAServer.address().port
  const joinerBPort = joinerBServer.address().port

  const indexerMeta = await wsOpen(`ws://127.0.0.1:${indexerPort}/meta`)
  indexerMeta.send(JSON.stringify({ t: 'gid', gid }))

  const hostMeta = await wsOpen(`ws://127.0.0.1:${hostPort}/meta`)
  hostMeta.send(JSON.stringify({ t: 'gid', gid }))
  hostMeta.send(JSON.stringify({ t: 'match-announce', gid, host: host.wallet.publicKey, status: 'open', maxPlayers: '3', players: [host.wallet.publicKey] }))

  const joinerAMeta = await wsOpen(`ws://127.0.0.1:${joinerAPort}/meta`)
  joinerAMeta.send(JSON.stringify({ t: 'gid', gid }))
  const joinerBMeta = await wsOpen(`ws://127.0.0.1:${joinerBPort}/meta`)
  joinerBMeta.send(JSON.stringify({ t: 'gid', gid }))
  joinerAMeta.send(JSON.stringify({ t: 'match-join', gid, from: joinerA.wallet.publicKey }))
  joinerBMeta.send(JSON.stringify({ t: 'match-join', gid, from: joinerB.wallet.publicKey }))
  const idxReady = await waitFor(() => indexer._wsInfo && indexer._wsInfo().games.includes(gid), 2000)
  const hostReady = await waitFor(() => host._wsInfo && host._wsInfo().games.includes(gid), 2000)
  const joinerAReady = await waitFor(() => joinerA._wsInfo && joinerA._wsInfo().games.includes(gid), 2000)
  const joinerBReady = await waitFor(() => joinerB._wsInfo && joinerB._wsInfo().games.includes(gid), 2000)
  if (!idxReady || !hostReady || !joinerAReady || !joinerBReady) {
    throw new Error(`gid was not registered before test (idx=${idxReady} host=${hostReady} a=${joinerAReady} b=${joinerBReady})`)
  }
  const hostMatchReady = await waitFor(() => !!host._matchSwarm, 2000)
  if (!hostMatchReady) throw new Error('host match swarm not created')
  await new Promise((resolve) => setTimeout(resolve, 100))
  hostMeta.send(JSON.stringify({ t: 'match-accept', gid, to: joinerA.wallet.publicKey }))
  hostMeta.send(JSON.stringify({ t: 'match-accept', gid, to: joinerB.wallet.publicKey }))
  const joinerAMatchReady = await waitFor(() => !!joinerA._matchSwarm, 2000)
  const joinerBMatchReady = await waitFor(() => !!joinerB._matchSwarm, 2000)
  if (!joinerAMatchReady || !joinerBMatchReady) {
    throw new Error(`joiner match swarms not created (a=${joinerAMatchReady} b=${joinerBMatchReady})`)
  }
  await connectSwarms(host._matchSwarm, joinerA._matchSwarm)
  await connectSwarms(host._matchSwarm, joinerB._matchSwarm)
  await new Promise((resolve) => setTimeout(resolve, 100))

  const hostDoom = await wsOpen(`ws://127.0.0.1:${hostPort}/doom`)
  const joinerADoom = await wsOpen(`ws://127.0.0.1:${joinerAPort}/doom`)
  const joinerBDoom = await wsOpen(`ws://127.0.0.1:${joinerBPort}/doom`)

  await new Promise((resolve) => setTimeout(resolve, 200))

  const uidA = 1111
  const uidB = 2222
  seedRoster([host, joinerA, joinerB, indexer], gid, 1, host.wallet.publicKey)
  seedRoster([host, joinerA, joinerB, indexer], gid, uidA, joinerA.wallet.publicKey)
  seedRoster([host, joinerA, joinerB, indexer], gid, uidB, joinerB.wallet.publicKey)

  joinerADoom.send(makePacket(1, uidA, 'hello-a'))
  joinerBDoom.send(makePacket(1, uidB, 'hello-b'))

  const hostPackets = await collectPackets(hostDoom, 2, 2000)
  const hostFroms = new Set(hostPackets.map((p) => p.from))
  if (!hostFroms.has(uidA) || !hostFroms.has(uidB)) {
    throw new Error(`host missing joiner packets, got from=${Array.from(hostFroms).join(',')}`)
  }

  const pktAPromise = waitForPacket(joinerADoom, (pkt) => pkt.from === 1, 2000)
  const pktBPromise = waitForPacket(joinerBDoom, (pkt) => pkt.from === 1, 2000)
  hostDoom.send(makePacket(uidA, 1, 'ack-a'))
  hostDoom.send(makePacket(uidB, 1, 'ack-b'))

  const pktA = await pktAPromise
  const pktB = await pktBPromise

  console.log('OK: ws-bridge relay delivers packets for 2 joiners via indexer.')

  for (const ws of [indexerMeta, hostMeta, joinerAMeta, joinerBMeta, hostDoom, joinerADoom, joinerBDoom]) {
    try { ws.close() } catch {}
  }
  for (const srv of [hostServer, indexerServer, joinerAServer, joinerBServer]) {
    try { srv.close() } catch {}
  }
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

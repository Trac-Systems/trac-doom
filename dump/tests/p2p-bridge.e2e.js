import net from 'node:net'
import Protomux from 'protomux'
import c from 'compact-encoding'
import crypto from 'node:crypto'
import { attachDoomP2PBridge } from '../src/doom/p2p-bridge.js'

function hex(n=32){ return crypto.randomBytes(n).toString('hex') }

// Create a simulated connection pair using bare-pipe and Protomux
async function makeLinkedMuxPair(){
  const server = net.createServer()
  await new Promise((resolve)=>server.listen(0, resolve))
  const port = server.address().port
  const client = net.connect({ port })
  const srvSock = await new Promise((resolve)=>server.once('connection', resolve))
  server.close()
  const muxA = Protomux.from(client)
  const muxB = Protomux.from(srvSock)
  client.userData = muxA
  srvSock.userData = muxB
  return [client, srvSock]
}

function makeFakePeer(connection){
  return {
    swarm: {
      connections: new Set([connection]),
      on: () => {}
    },
    wallet: { publicKey: hex(32) },
    protocol_instance: { api: { getNick: async () => null } },
    options: { channel: 'e2e' }
  }
}

function makeModule(){ return { Module: {} } }

async function main(){
  const [conn1, conn2] = await makeLinkedMuxPair()
  const peer1 = makeFakePeer(conn1)
  const peer2 = makeFakePeer(conn2)

  const M1 = makeModule()
  const M2 = makeModule()

  attachDoomP2PBridge(peer1, 'doom-e2e', M1)
  attachDoomP2PBridge(peer2, 'doom-e2e', M2)

  // init: server=peer1(uid=1), client learns uid on first send
  M1.Module.tracp2p.init(true)
  M2.Module.tracp2p.init(false)

  // Craft a payload: [to(4 LE)][from(4 LE)][payload]
  const to = 1 >>> 0
  const from = 1234 >>> 0
  const payload = new Uint8Array(8 + 5)
  new DataView(payload.buffer).setUint32(0, to, true)
  new DataView(payload.buffer).setUint32(4, from, true)
  payload.set(new TextEncoder().encode('hello'), 8)

  // give mux time to open both ends
  await new Promise(r => setTimeout(r, 100))
  // client sends to server
  const ok = M2.Module.tracp2p.send(to, payload, from)
  if (!ok) throw new Error('send() failed')

  // poll on server
  const pkt = await new Promise((resolve) => {
    const iv = setInterval(() => {
      const r = M1.Module.tracp2p.poll()
      if (r) { clearInterval(iv); resolve(r) }
    }, 10)
    setTimeout(() => { clearInterval(iv); resolve(null) }, 1000)
  })
  if (!pkt) throw new Error('No packet received')
  const dv = new DataView(pkt.data.buffer, pkt.data.byteOffset, pkt.data.byteLength)
  const fromRecv = dv.getUint32(0, true)
  const msg = new TextDecoder().decode(pkt.data.subarray(4))
  if (fromRecv !== from) throw new Error('from mismatch')
  if (msg !== 'hello') throw new Error('payload mismatch')
  console.log('OK: p2p-bridge packet roundtrip over Protomux succeeded.')
  try { conn1.end(); } catch {}
  try { conn2.end(); } catch {}
  try { conn1.destroy(); } catch {}
  try { conn2.destroy(); } catch {}
  process.exit(0)
}

main().catch((e)=>{ console.error(e); process.exit(1) })

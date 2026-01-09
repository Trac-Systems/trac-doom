// Resolve deps under Electron (Node resolver) first; fallback to ESM dynamic import in browsers
let Protomux, c
if (typeof window !== 'undefined' && typeof window.require === 'function') {
  try {
    Protomux = window.require('protomux')
    c = window.require('compact-encoding')
  } catch (e) {}
}
if (!Protomux || !c) {
  Protomux = (await import('protomux')).default
  c = (await import('compact-encoding')).default
}

// Bridge between doom-wasm C net module and trac-peer's Hyperswarm
// Exposes Module.tracp2p for emscripten EM_JS stubs

export function attachDoomP2PBridge(peer, protocolName = 'doom-p2p', moduleTarget = null) {
  const state = {
    isServer: false,
    selfUid: null,
    queue: [], // { from: number, data: Uint8Array(with [from|payload]) }
    channels: new Map(), // connection -> { message }
    ready: false,
    meta: {
      map: new Map(), // uid -> { address, nick }
      channels: new Map(), // connection -> { message }
      selfNick: null,
      helloTimer: null
    }
  }
  state.game = { id: null, seq: 0 }
  const gameReadyCache = { gid: null, ok: false, ts: 0 }

  async function isGameReady (gid) {
    if (!gid) return false
    const now = Date.now()
    if (gameReadyCache.gid === gid && (now - gameReadyCache.ts) < 1000) return gameReadyCache.ok
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
    gameReadyCache.gid = gid
    gameReadyCache.ok = ok
    gameReadyCache.ts = now
    return ok
  }

  function ensureChannel(connection){
    if(state.channels.has(connection)) return state.channels.get(connection)
    const mux = connection.userData ? connection.userData : Protomux.from(connection)
    const ch = mux.createChannel({ protocol: protocolName, onopen() {}, onclose() {} })
    ch.open()
    const message = ch.addMessage({ encoding: c.raw, onmessage (buf) {
      try {
        // buf layout: [to(4 LE)][from(4 LE)][payload]
        if (!(buf instanceof Uint8Array)) return
        if (buf.byteLength < 8) return
        const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
        const to = view.getUint32(0, true)
        const from = view.getUint32(4, true)
        // filter: deliver only if 'to' matches our uid (or broadcast 0 to server)
        if (state.selfUid === null) return
        if (to !== 0 && to !== (state.selfUid>>>0)) return
        const out = new Uint8Array(buf.byteLength - 4)
        // construct [from|payload]
        new DataView(out.buffer).setUint32(0, from>>>0, true)
        out.set(buf.subarray(8), 4)
        state.queue.push({ from, data: out })
      } catch (e) {}
    }})
    const obj = { message: message }
    state.channels.set(connection, obj)
    return obj
  }

  // create channels for existing and future connections
  if(peer.swarm){
    for (const conn of peer.swarm.connections) ensureChannel(conn)
    peer.swarm.on('connection', (connection) => {
      ensureChannel(connection)
    })
  }

  // Meta channel for uid<->address mapping announcements
  const metaProto = `${protocolName}-meta`
  function ensureMeta(connection){
    if (state.meta.channels.has(connection)) return state.meta.channels.get(connection)
    const mux = connection.userData ? connection.userData : Protomux.from(connection)
    const ch = mux.createChannel({ protocol: metaProto, onopen(){}, onclose(){} })
    ch.open()
    const message = ch.addMessage({ encoding: c.json, onmessage (msg) {
      try{
        if (msg && msg.t === 'hello' && typeof msg.uid === 'number' && typeof msg.address === 'string'){
          state.meta.map.set(msg.uid>>>0, { address: msg.address, nick: msg.nick || null })
          // If server includes game id, capture it for clients
          if (!state.isServer && msg.gid && !state.game.id) state.game.id = String(msg.gid)
        }
      }catch(e){}
    }})
    const obj = { message }
    state.meta.channels.set(connection, obj)
    // proactively say hello on new meta channel
    queueHello()
    return obj
  }
  if(peer.swarm){
    for (const conn of peer.swarm.connections) ensureMeta(conn)
    peer.swarm.on('connection', (connection)=>ensureMeta(connection))
  }

  async function refreshSelfNick(){
    try {
      if (peer?.protocol_instance?.api?.getNick) {
        const n = await peer.protocol_instance.api.getNick(peer.wallet.publicKey)
        if (typeof n === 'string' && n.length) state.meta.selfNick = n
      }
    } catch (e) {}
  }

  function sendHello(){
    const msg = { t:'hello', uid: state.selfUid>>>0, address: peer.wallet.publicKey, nick: state.meta.selfNick, gid: state.game.id }
    for (const { message } of state.meta.channels.values()) {
      try { message.send(msg) } catch (e) {}
    }
  }

  function queueHello(){
    // send once now and then periodically to keep mappings fresh
    if (state.selfUid !== null) sendHello()
    if (state.meta.helloTimer) return
    state.meta.helloTimer = setInterval(() => {
      if (!state.ready) return
      if (state.selfUid === null) return
      sendHello()
    }, 10000)
  }

  // Attach to Module for C side stubs; supports custom target for tests
  const tgt = moduleTarget || globalThis
  if (!tgt.Module) tgt.Module = {}
  if (!tgt.Module.tracp2p) tgt.Module.tracp2p = {}

  tgt.Module.tracp2p.init = function(isServer){
    state.isServer = !!isServer
    // server UID is always 1 per d_loop.c; client UID learned on first send()
    if (state.isServer) state.selfUid = 1
    state.ready = true
    // try to learn nick and broadcast our mapping early
    refreshSelfNick().finally(queueHello)
    return true
  }

  // to_ip ignored for now; broadcast over swarm on same topic
  tgt.Module.tracp2p.send = function(to_ip, payload, from_ip){
    try{
      if (state.selfUid === null) state.selfUid = from_ip >>> 0
      // ensure payload includes [from|payload]
      // payload from C side includes [to(4)|from(4)|data]
      for(const conn of peer.swarm.connections){
        const ch = ensureChannel(conn)
        ch.message.send(payload)
      }
      // Announce our address mapping across all meta channels
      queueHello()
      return true
    }catch(e){ return false }
  }

  tgt.Module.tracp2p.poll = function(){
    if (state.queue.length === 0) return null
    return state.queue.shift()
  }

  tgt.Module.tracp2p.setGameId = function(gid){
    state.game.id = String(gid)
    state.game.seq = 0
    gameReadyCache.gid = state.game.id
    gameReadyCache.ok = false
    gameReadyCache.ts = 0
    queueHello()
  }

  // Strict kill recording: only the server sends tx with gid+seq and both addresses
  tgt.Module.tracp2p.recordKillStrict = async function(killerUid, victimUid){
    if (!state.isServer) return // server-authoritative
    if (!state.game.id) return
    const ok = await isGameReady(state.game.id)
    if (!ok) return
    try{
      const km = state.meta.map.get((killerUid>>>0))
      const vm = state.meta.map.get((victimUid>>>0))
      if (!km || !vm) return
      const killer = km.address
      const victim = vm.address
      state.game.seq = (state.game.seq|0) + 1
      await peer.protocol_instance.api.recordKillStrict(state.game.id, state.game.seq, killer, victim)
    }catch(e){ /* ignore */ }
  }
}

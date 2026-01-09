import http from 'http'
import { URL } from 'url'
import { getEnv } from '../env.js'

export function attachRpcServer (peer, { port = 7767 } = {}) {
  const server = http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url, `http://127.0.0.1:${port}`)
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

      if (u.pathname === '/health') return json(res, { ok: true })

      if (u.pathname === '/info' && req.method === 'GET') {
        const pub = peer.wallet.publicKey
        const channel = peer.options.channel
        const peers = Array.from(peer.connectedPeers || [])
        const env = getEnv()
        const dnetPort = peer._dnetPort || parseInt(env.TRAC_DNET_PORT || '7788')
        const rpcPort = port
        const isIndexer = !!(peer?.base?.isIndexer)
        return json(res, { publicKey: pub, channel, peers, dnetPort, rpcPort, isIndexer })
      }

      if (u.pathname === '/ws/info' && req.method === 'GET') {
        const info = typeof peer._wsInfo === 'function' ? peer._wsInfo() : { doomClients: 0, metaClients: 0, games: [], lastGid: null }
        return json(res, info)
      }

      if (u.pathname === '/nick' && req.method === 'GET') {
        const addr = u.searchParams.get('addr') || ''
        let n = null
        try { n = await peer.protocol_instance.api.getNick(addr) } catch {}
        return json(res, { nick: (typeof n === 'string' && n.length) ? n : null })
      }

      if (u.pathname === '/view' && req.method === 'GET') {
        const key = u.searchParams.get('key') || ''
        let v = null
        try { v = await peer.base.view.get(key) } catch {}
        return json(res, { value: v })
      }

      if (u.pathname === '/startGame' && req.method === 'POST') {
        const body = await readJson(req)
        await peer.protocol_instance.api.startGame(body.gid, body.mode)
        return json(res, { ok: true })
      }

      if (u.pathname === '/endGame' && req.method === 'POST') {
        const body = await readJson(req)
        await peer.protocol_instance.api.endGame(body.gid)
        return json(res, { ok: true })
      }

      if (u.pathname === '/recordKillStrict' && req.method === 'POST') {
        const { gid, seq, killer, victim } = await readJson(req)
        await peer.protocol_instance.api.recordKillStrict(gid, seq, killer, victim)
        return json(res, { ok: true })
      }

      if (u.pathname === '/postChat' && req.method === 'POST') {
        const { text } = await readJson(req)
        if (typeof text !== 'string' || !text.trim()) return json(res, { ok: false, error: 'invalid_message' })
        const status = await peer.base.view.get('chat_status')
        if (!status || status.value !== 'on') return json(res, { ok: false, error: 'chat_disabled' })
        const nonce = peer.protocol_instance.generateNonce()
        const prepared = peer.protocol_instance.api.prepareMessage(text, peer.wallet.publicKey)
        const signature = peer.wallet.sign(JSON.stringify(prepared) + nonce)
        await peer.protocol_instance.api.post(prepared, signature, nonce)
        return json(res, { ok: true })
      }

      if (u.pathname === '/setNick' && req.method === 'POST') {
        const { nick } = await readJson(req)
        if (typeof nick !== 'string' || !nick.length) return json(res, { ok: false, error: 'invalid_nick' })
        const nonce = peer.protocol_instance.generateNonce();
        const signature = { dispatch : {
          type : 'setNick',
          nick: nick,
          address : peer.wallet.publicKey,
          initiator: peer.wallet.publicKey
        }};
        const hash = peer.wallet.sign(JSON.stringify(signature) + nonce);
        await peer.base.append({type: 'setNick', value: signature, hash : hash, nonce: nonce });
        return json(res, { ok: true })
      }

      res.writeHead(404); res.end('Not found')
    } catch (e) {
      res.writeHead(500, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: e?.message || String(e) }))
    }
  })
  server.on('error', (e) => {
    if (e && e.code === 'EADDRINUSE') {
      console.log(`[rpc] port ${port} in use; another instance already running`)
    } else {
      console.log('[rpc] server error:', e?.message || e)
    }
  })
  server.listen(port, '127.0.0.1')
  return server
}

function json (res, obj) {
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify(obj))
}

function readJson (req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (c) => { data += c })
    req.on('end', () => {
      try { resolve(JSON.parse(data || '{}')) } catch (e) { reject(e) }
    })
    req.on('error', reject)
  })
}

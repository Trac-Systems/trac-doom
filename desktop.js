// This file runs as a normal script (not ESM). Use Node resolution via window.require in Electron.
(async function(){
  const React = window.require('react')
  const { createRoot } = window.require('react-dom/client')
  const { html } = window.require('htm/react')
  let fs = null; try { fs = window.require('fs') } catch (e) {}
  // Doom networking: use upstream Doom WS client via -wss; a separate WS is used for meta (nick/gid)

  // Resolve ports from env (Electron renderer has process.env with nodeIntegration)
  const rpcPort = (typeof process !== 'undefined' && process.env && process.env.TRAC_RPC_PORT) ? parseInt(process.env.TRAC_RPC_PORT) : 7767
  const dnetPortEnv = (typeof process !== 'undefined' && process.env && process.env.TRAC_DNET_PORT) ? parseInt(process.env.TRAC_DNET_PORT) : 7788
  // HTTP RPC client for the terminal peer
  const RPC = {
    async get(path){ const r = await fetch(`http://127.0.0.1:${rpcPort}${path}`); return r.json() },
    async post(path, body){ const r = await fetch(`http://127.0.0.1:${rpcPort}${path}`, { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(body) }); return r.json() }
  }
  const peer = {
    async ready(){ return },
    get wallet(){ return { publicKey: '' } },
    get options(){ return { channel: '' } },
    get connectedPeers(){ return new Set() },
    async init(){
      const info = await RPC.get('/info')
      this.wallet.publicKey = info.publicKey
      this.options.channel = info.channel
      this.connectedPeers = new Set(info.peers || [])
      this.dnetPort = (typeof info.dnetPort === 'number') ? info.dnetPort : dnetPortEnv
      setInterval(async ()=>{
        try{
          const i = await RPC.get('/info')
          this.connectedPeers = new Set((i&&i.peers)||[])
          if (i && typeof i.dnetPort === 'number') this.dnetPort = i.dnetPort
        }catch{}
      }, 1000)
    },
    protocol_instance: { api: {
      getNick: async (addr) => { const r = await RPC.get('/nick?addr='+encodeURIComponent(addr)); return r.nick || null },
      startGame: (gid) => RPC.post('/startGame', { gid }),
      recordKillStrict: (gid, seq, killer, victim) => RPC.post('/recordKillStrict', { gid, seq, killer, victim })
    }},
    base: { view: { get: async (key) => { const r = await RPC.get('/view?key='+encodeURIComponent(key)); return r.value ?? null } } }
  }
  await peer.init()

// Simple lobby + wasm loader
function DoomApp() {
  const [stage, setStage] = React.useState('lobby') // lobby | running
  const [status, setStatus] = React.useState('')
  const [nick, setNick] = React.useState('')
  const [peers, setPeers] = React.useState([])
  const [peerNicks, setPeerNicks] = React.useState(new Map())
  const [scores, setScores] = React.useState([]) // [{ address, count, nick }]
  const [scoreLoading, setScoreLoading] = React.useState(false)
  const [error, setError] = React.useState('')

  React.useEffect(() => {
    let mounted = true
    ;(async () => {
      try{
        const n = await peer.protocol_instance.api.getNick(peer.wallet.publicKey)
        if(mounted && n) setNick(n)
      }catch(e){}
    })()
    async function resolveNicks(addrs){
      try{
        const m = new Map(peerNicks)
        for (const a of addrs){
          if (!m.has(a) && peer?.protocol_instance?.api?.getNick){
            try{
              const n = await peer.protocol_instance.api.getNick(a)
              if (typeof n === 'string' && n.length) m.set(a, n)
            }catch(e){}
          }
        }
        if (mounted) setPeerNicks(m)
      }catch(e){}
    }
    const iv = setInterval(() => {
      const list = Array.from(peer.connectedPeers)
      setPeers(list)
      resolveNicks(list)
    }, 1000)
    return () => { mounted = false; clearInterval(iv) }
  }, [])

  async function saveNick(){
    try{
      await RPC.post('/setNick', { nick: ''+nick })
    }catch(e){ setError(String(e)) }
  }

  async function startDoom(isHost){
    setError('')
    setStatus('Initializing Doom...')
    try{
      // Meta WS for identity/gid announcements only (separate from the game WS used by -wss)
      const dnetPort = (peer && typeof peer.dnetPort === 'number') ? peer.dnetPort : dnetPortEnv
      let metaWS = null
      function ensureMetaWS(){
        if (metaWS && metaWS.readyState === WebSocket.OPEN) return true
        if (metaWS && metaWS.readyState === WebSocket.CONNECTING) return false
        const ws = new WebSocket(`ws://127.0.0.1:${dnetPort}/meta`)
        ws.onopen = async () => {
          try {
            const info = await RPC.get('/info')
            // Renderer uid is unknown to upstream engine; announce client/server role and local addr/nick for mapping.
            const isServer = !!isHost
            const uid = isServer ? 1 : null
            ws.send(JSON.stringify({ t:'hello', isServer, uid }))
            if (isHost && gameId) ws.send(JSON.stringify({ t:'gid', gid: gameId }))
            let nickVal = null; try { const r = await RPC.get('/nick?addr='+encodeURIComponent(info.publicKey)); nickVal = r.nick||null } catch {}
            ws.send(JSON.stringify({ t:'mhello', uid: (uid==null?0:uid), address: info.publicKey, nick: nickVal }))
          } catch {}
        }
        ws.onclose = () => { metaWS = null; setTimeout(ensureMetaWS, 2000) }
        metaWS = ws
        return false
      }
      // If hosting, generate a game id and announce it strictly on-chain
      let gameId = null
      if (isHost) {
        gameId = `doom-${peer.wallet.publicKey.slice(0,8)}-${Date.now()}`
        try{ await peer.protocol_instance.api.startGame(gameId) }catch(e){ setError('Failed to start game on-chain: '+String(e)); return }
      }

      // Prepare Module for emscripten bundle
      const canvas = document.getElementById('canvas')
      if (canvas) {
        try { canvas.tabIndex = 1 } catch {}
        try { setTimeout(() => { try { canvas.focus() } catch {} }, 0) } catch {}
      }
      const wadPath = 'third_party/doom-wasm/src/doom1.wad'
      let wadBuf
      try{
        if (fs && fs.readFileSync) {
          wadBuf = fs.readFileSync(wadPath)
        } else {
          const res = await fetch(wadPath)
          if (!res.ok) throw new Error('Failed to fetch doom1.wad over HTTP')
          const ab = await res.arrayBuffer()
          wadBuf = new Uint8Array(ab)
        }
      } catch(e) {
        setError('doom1.wad not found or failed to load. Place it at third_party/doom-wasm/src/doom1.wad or serve it over HTTP. '+String(e))
        return
      }
      const forceHost = (typeof process !== 'undefined' && process.env && process.env.TRAC_FORCE_DNET_HOST) ? String(process.env.TRAC_FORCE_DNET_HOST) : null
      const forcePortEnv = (typeof process !== 'undefined' && process.env && process.env.TRAC_FORCE_DNET_PORT) ? parseInt(process.env.TRAC_FORCE_DNET_PORT) : null
      const targetHost = forceHost || '127.0.0.1'
      const initialPort = (forcePortEnv != null) ? forcePortEnv : dnetPort
      const resolvedDnetPort = initialPort
      const wssHost = targetHost

      // Allow configuring max players via env (defaults to 2)
      const maxPlayers = (typeof process !== 'undefined' && process.env && process.env.TRAC_PLAYERS)
        ? String(process.env.TRAC_PLAYERS)
        : '2'

      let Module = {
        onRuntimeInitialized: () => {
          // Revert to default GUI mode (no -nogui) for proper WebGL rendering
          const args = [
            "-iwad", "doom1.wad",
            "-window", "-nomusic", "-nosound",
            "-config", "default.cfg",
            "-wss", `ws://${wssHost}:${resolvedDnetPort}/doom`
          ]
          if (isHost) {
            args.push('-server')
            // Chocolate Doom uses the first client\'s connect data to set max players.
            // Ensure the server accepts at least one joiner by declaring max players.
            args.push('-players', maxPlayers)
          } else {
            args.push('-connect', '1')
          }
          callMain(args)
          // Auto-focus canvas and auto-ready on joiners (Chocolate Doom requires marking ready in waiting room)
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
        },
        noInitialRun: true,
        // Ensure Emscripten finds the wasm/glue next to the JS bundle
        locateFile: (p) => `third_party/doom-wasm/src/${p}`,
        preRun: [async function(){
          Module.FS_createDataFile('/', 'doom1.wad', wadBuf, true, true)
          try{
            let cfgBuf
            if (fs && fs.readFileSync) {
              cfgBuf = fs.readFileSync('third_party/doom-wasm/src/default.cfg')
            } else {
              const res = await fetch('third_party/doom-wasm/src/default.cfg')
              if (res.ok) cfgBuf = new Uint8Array(await res.arrayBuffer())
            }
            if (cfgBuf) Module.FS_createDataFile('/', 'default.cfg', cfgBuf, true, true)
          }catch(e){}
        }],
        print: (t) => console.log(t),
        printErr: (t) => console.error(t),
        canvas: canvas,
        setStatus: (t) => setStatus(t || '')
      }
      // Make Module global for emscripten loader
      window.Module = Module
      // Kick off meta announcements in parallel
      ensureMetaWS()

      // Load wasm bundle built from third_party/doom-wasm
      const jsPath = 'third_party/doom-wasm/src/websockets-doom.js'
      const s = document.createElement('script')
      s.type = 'text/javascript'
      // Temporarily hide Node's process so Emscripten selects WEB env and defines setWindowTitle
      const savedProcess = window.process
      try {
        // Best effort: some Electron builds mark this readonly; ignore failures
        window.process = undefined
      } catch (e) {
        try { Object.defineProperty(window, 'process', { value: undefined, configurable: true, writable: true }) } catch {}
      }
      s.src = jsPath
      s.onload = () => {
        // Restore process for the rest of the app
        try { window.process = savedProcess } catch {}
        setStage('running')
      }
      s.onerror = () => {
        try { window.process = savedProcess } catch {}
        setError('Failed to load Doom bundle. Build it first (see README).')
      }
      document.body.appendChild(s)
    }catch(e){
      setError(String(e))
    }
  }

  async function loadScoreboard(){
    setScoreLoading(true)
    setError('')
    try{
      // read kill log length
      const lenRec = await peer.base.view.get('klogl')
      const len = lenRec === null ? 0 : parseInt(lenRec.value)
      const counts = new Map()
      for (let i = 0; i < len; i++){
        const rec = await peer.base.view.get('klog/'+i)
        if (rec === null) continue
        const v = rec.value
        const entry = (v && typeof v === 'object') ? v : null
        if (!entry || !entry.killer) continue
        const k = ''+entry.killer
        counts.set(k, (counts.get(k)||0)+1)
      }
      // decorate with nicknames
      const out = []
      for (const [address, count] of counts.entries()){
        let n = null
        try{ n = await peer.protocol_instance.api.getNick(address) }catch(e){}
        out.push({ address, count, nick: (typeof n === 'string' && n.length) ? n : null })
      }
      out.sort((a,b)=> b.count - a.count)
      setScores(out)
    }catch(e){ setError(String(e)) }
    finally{ setScoreLoading(false) }
  }

  return html`
    <main style=${{flexDirection:'column', gap: '1rem', padding:'1rem'}}>
      ${stage === 'lobby' && html`<div key="lobby">
        <section>
          <div>Your public key: ${peer.wallet.publicKey}</div>
          <div>Channel: ${peer.options.channel}</div>
          <div>Peers connected: ${peers.length}</div>
          ${peers.length > 0 && html`<div>
            Peers: ${peers.map(a => peerNicks.get(a) ? `${peerNicks.get(a)} (${a.slice(0,8)}…)` : a).join(', ')}
          </div>`}
          <div style=${{display:'flex', gap:'.5rem', marginTop:'.5rem'}}>
            <input value=${nick} onInput=${e=>setNick(e.target.value)} placeholder="nickname" />
            <button onClick=${saveNick}>Save Nick</button>
          </div>
        </section>
        <section style=${{display:'flex', gap:'1rem'}}>
          <button onClick=${()=>startDoom(true)}>Host Game</button>
          <button onClick=${()=>startDoom(false)}>Join Game</button>
        </section>
        <section>
          <div style=${{display:'flex', alignItems:'center', gap:'.5rem'}}>
            <strong>Scoreboard</strong>
            <button onClick=${loadScoreboard} disabled=${scoreLoading}>${scoreLoading ? 'Loading…' : 'Refresh'}</button>
          </div>
          ${scores.length === 0 && html`<div>No kills recorded yet.</div>`}
          ${scores.length > 0 && html`<div>
            ${scores.map(s => html`<div key=${s.address}>
              ${s.nick ? `${s.nick} (${s.address.slice(0,8)}…)` : s.address}: ${s.count}
            </div>`)}
          </div>`}
        </section>
        ${status && html`<div>${status}</div>`}
        ${error && html`<div style=${{color:'tomato'}}>${error}</div>`}
      </div>`}
      ${stage === 'running' && html`<div key="running">
        <div>Doom running. Press ESC to quit in-game.</div>
      </div>`}
      <canvas className="frame" id="canvas" width="800" height="600"></canvas>
    </main>
  `
}

  const root = createRoot(document.querySelector('#root'))
  root.render(html`<${DoomApp}/>`)
})().catch(err => console.error('[desktop] init failed', err))

import ReadyResource from "ready-resource";
import {Peer, Wallet} from "trac-peer";
import {MainSettlementBus} from 'trac-msb/src/index.js';
import { attachRpcServer } from './rpc/server.js';
import { attachDoomWSBridge } from './doom/ws-bridge.js';
import { getEnv } from './env.js';

export class App extends ReadyResource {
    constructor(msb_opts, peer_opts, features = []) {
        super();
        this.msb = null;
        this.peer = null;
        this.features = features;
        this.msb_opts = msb_opts;
        this.peer_opts = peer_opts;
    }

    async start(){
        this.msb_opts.stores_directory = '';
        this.msb_opts.enable_wallet = false;
        this.msb_opts.enable_updater = false;
        this.msb_opts.enable_interactive_mode = false;
        console.log('=============== STARTING MSB ===============');
        this.msb = new MainSettlementBus(this.msb_opts);
        const _this = this;
        await this.msb.ready();
        console.log('=============== STARTING PEER ===============');
        this.peer_opts.stores_directory = '';
        this.peer_opts.msb = this.msb;
        this.peer_opts.wallet = new Wallet();
        this.peer = new Peer(this.peer_opts);
        await this.peer.ready();
        console.log('Peer is ready.');
        try {
            const env = getEnv()
            const port = parseInt(env.TRAC_RPC_PORT || '7767')
            const allowIndexerRpc = env.TRAC_INDEXER_RPC === '1' || env.TRAC_INDEXER_RPC === 'true'
            if (this.peer?.base?.isIndexer && !allowIndexerRpc) {
                console.log('[app] indexer detected; skipping RPC server')
            } else {
                attachRpcServer(this.peer, { port })
                console.log('RPC server listening on http://127.0.0.1:' + port)
            }
        } catch (e) { console.log('RPC server failed:', e?.message || e) }
        try {
            const env = getEnv()
            const dport = parseInt(env.TRAC_DNET_PORT || '7788')
            // expose desired dnet port for RPC visibility (actual bound port may change)
            this.peer._dnetPort = dport
            // Always attach p2p forwarder. Only attach WS endpoints on non-indexers.
            if (this.peer?.base?.isIndexer) {
              console.log('[app] indexer detected; attaching p2p forwarder only')
              attachDoomWSBridge(this.peer, { port: dport, disableWS: true })
            } else {
              attachDoomWSBridge(this.peer, { port: dport, disableWS: false })
            }
        } catch (e) { console.log('WS bridge failed:', e?.message || e) }
        const admin = await this.peer.base.view.get('admin');
        if(null !== admin && this.peer.wallet.publicKey === admin.value && this.peer.base.writable) {
            for(let i = 0; i < this.features.length; i++){
                const name = this.features[i].name;
                const _class = this.features[i].class;
                const opts = this.features[i].opts;
                const obj = new _class(this.peer, opts);
                await this.peer.protocol_instance.addFeature(name, obj);
                obj.start();
            }
        }
        const env = getEnv()
        const interactive = !(env.TRAC_INTERACTIVE === '0' || env.TRAC_INTERACTIVE === 'false')
        if (interactive) this.peer.interactiveMode();
        _this.ready().catch(function(){});
    }

    getPeer(){
        return this.peer;
    }
}

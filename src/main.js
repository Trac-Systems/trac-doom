import { getStorePath } from './functions.js'
import { App } from './app.js'
import { default as SampleProtocol } from '../contract/protocol.js'
import { default as SampleContract } from '../contract/contract.js'
import { Timer } from '../features/timer/index.js'

console.log('Peer boot: Storage path:', getStorePath())

///// MSB SETUP
const msb_opts = {}
msb_opts.bootstrap = 'a4951e5f744e2a9ceeb875a7965762481dab0a7bb0531a71568e34bf7abd2c53'
msb_opts.channel = '0002tracnetworkmainsettlementbus'
msb_opts.store_name = getStorePath() + '/msb'

///// SAMPLE CONTRACT SETUP
const peer_opts = {}
peer_opts.protocol = SampleProtocol
peer_opts.contract = SampleContract
peer_opts.bootstrap = 'c540e5828475337da0344df1b31827cfcb4f79d2e0f3c52095551b9c6e2840ef'
peer_opts.channel = '000000000000000000000000tracdoom'
peer_opts.store_name = getStorePath() + '/tracdoom'
peer_opts.api_tx_exposed = true
peer_opts.api_msg_exposed = true

///// FEATURES
const timer_opts = {}
timer_opts.update_interval = 60_000

export const app = new App(msb_opts, peer_opts, [
  { name: 'timer', class: Timer, opts: timer_opts }
])

await app.start()

# Contract Example

Contracts on Trac Network are infrastructure. 

This means each participant executes contracts in distributed apps (App3: decentralized apps / embedded contracts).

Alternatively a group of Peers (nodes) may accept transactions from external wallets to offer traditional web3 experiences.

The most important files to check out and learn how everything works are:

- **/contract/protocol.js**: defines the framework for the contract.
- **/contract/contract.js**: the actual contract.
- **/features/timer/index.js**: a Feature (aka oracle) for the contract
- **/desktop/index.html** and **/desktop/index.js**: to learn running as App3 (see bottom notes)
- **/index.js**: the setup for the contract app that everyone uses (the entire package represents an app)

Release 1 (R1) must be used alongside Trac Network R1 releases to maintain contract consistency.

Trac Apps utilizes the [Pear Runtime and Holepunch](https://pears.com/).

## Install

```shell
git clone git@github.com:Trac-Systems/trac-contract-example.git
```

While the Trac apps support native node-js, it is encouraged to use Pear:

```js
cd trac-contract-example
npm install -g pear
npm install
pear run . store1
```

## Setup

**Deploy Bootstrap (admin):**

- Choose option 1)
- Copy and backup the seedphrase
- Copy the "Peer Writer" key from the Peer section (basically the contract address)
- With a text editor, open the file index.js in document root
- Replace the bootstrap address in the example section (not the MSB) with the copied writer address
- Choose a channel name (exactly 32 characters)
- Type /exit and hit enter, then run again: pear run . store1
- After the options appear, type "/add_admin --address YourPeerAddress" and hit enter
- Your instance is now the Bootstrap and admin peer of your contract network.
- Keep your bootstrap node running
- For production contracts, it is strongly recommended to add a couple of indexers. See below.

**Running indexers (admin)**

- Install on different machines than the Bootstrap's (ideally different data centers) with the exact setup in index.js
- Upon start ("pear run . store1") copy the "Peer Writer" key
- In the Bootstrap node screen, add the indexer: "/add_indexer --key TheIndexerWriterKey."
- You should see a success confirmation
- Usually 2 indexers on different locations are enough, we recommend 2 to max. 4 in addition to the Bootstrap

**Enable others to join and to transact:**

- By default, people cannot auto-join the contract network. The network admin (the Bootstrap in this case) can enable auto-join
- To enable auto-join, in the screen of the Bootstrap enter "/set_auto_add_writers --enabled 1"
- Any other Peer joining with the exact same setup can join the network and execute contract functions and transactions.
- Users may join using the exact same setup in index.js and start using "pear run . store1"
- For more features, play around with the available system and chat options.

# App3 (Pear v2 desktop)
- Set `"main": "index.js"` (JS entrypoint).
- Set `pear.type` to `desktop`.
- Run: `pear run -d . store1`
- Wait for the app to load. `-d` opens the developer console.
- Each desktop instance creates its own identity (wallet) automatically upon first start.
- Note: mobile app deployment is in the works by the team.

# Web3
If your contract is not supposed to run as user-installable app, you can run it as server instead.
There is no special setup required other than exposing the Protocol api to your services.

To allow signers with webwallets to submit transactions through your server, enable the transaction API.
For chat messages, accordingly. See below.

Note: Trac Network mainnet is not released yet and there are no web wallets at this moment. 
But you may create an identity wallet to sign off transactions for web3 apps. 
We recommend to use the library ["micro-key-producer/slip10.js"](https://www.npmjs.com/package/micro-key-producer) package for this (using ed25519 keys).

You can find all built-in api functions in trac-peer/src/api.js
Custom api functions (per-app) can be found in /contract/protocol.js and vary by the different app projects.

```js
peer_opts.api_tx_exposed = true;
peer_opts.api_msg_exposed = true;
```


## Doom WASM P2P Quickstart (Pear v2)

Prereqs
- Place `third_party/doom-wasm/src/doom1.wad` on every peer (sha1 must match).
- Install Pear v2: `npm install -g pear`
- Install deps: `npm install`

Run model (Pear-only)
- Desktop (Pear UI) now starts the backend automatically in the same process.
- Terminal mode is only needed for admin/indexer commands.
- Each running process needs its own store directory (do not reuse the same store twice).

Switching between terminal and desktop (edit `package.json` before each run)
- Terminal backend (CLI prompt):
  - `"main": "src/main.js"`
  - `"pear.type": "terminal"`
- Desktop UI:
  - `"main": "index.js"`
  - `"pear.type": "desktop"`

Entrypoints (Pear v2)
- Backend/indexer (terminal): `pear run -d . <store>`
- Desktop UI + backend: `pear run -d . <store>`
- Optional: `TRAC_START_PEER=0` disables backend auto-start (UI-only).
- The entrypoint is controlled by `main` above; passing a file path here is treated as a route and will show source in desktop mode.

Bootstrap/admin (Pear terminal)
- Start the bootstrap peer (terminal settings above):
  - `TRAC_RPC_PORT=7768 TRAC_DNET_PORT=7788 pear run -d . store_bootstrap`
- In the terminal, run:
  - `/add_admin --address <your_public_key>`
  - `/set_auto_add_writers --enabled 1`
- Keep this node running.

Indexer (Pear terminal)
- Start once to get its writer key:
  - `TRAC_RPC_PORT=7766 pear run -d . store_indexer`
- In the bootstrap terminal, add it:
  - `/add_indexer --key <indexer_writer_key>`
- Restart the indexer with the same command.

Host (backend + UI on the same machine)
- Switch to desktop settings and start host:
  - `TRAC_RPC_PORT=7769 TRAC_DNET_PORT=7789 TRAC_PLAYERS=2 pear run -d . store_host`

Joiner (backend + UI on the same machine)
- Switch to desktop settings and start joiner:
  - `TRAC_RPC_PORT=7770 TRAC_DNET_PORT=7790 pear run -d . store_joiner`

Sequence (Chocolate Doom netplay)
- Host: click "Host Game" and wait.
- Joiner: click "Join". The UI auto-toggles Ready after connect.
- Host: press Space/New Game to launch for everyone.

Health
- `curl http://127.0.0.1:7769/ws/info` -> `{ doomClients, metaClients, games, lastGid }`.

Notes
- Admin/indexer commands only work in terminal mode (not in Pear UI).
- Each machine should run its own local peer and UI; P2P connects them.
- `TRAC_INTERACTIVE=1` re-enables the CLI prompt when running in desktop mode.
- Audio uses WebAssembly threads via AudioWorklet; the UI injects `--enable-features=SharedArrayBuffer,WebAssemblyThreads`. If you see SharedArrayBuffer errors, verify you are on Pear v2 and flags are not stripped.
- Pear v2 enforces a single on-disk instance per app directory. If a terminal peer is already running from this repo, a desktop run from the same repo will exit immediately. For local indexer+UI testing, use a second on-disk copy of the repo or run the indexer on another machine.

## Doom WASM P2P Quickstart (Legacy Electron)

This project embeds Cloudflare’s Doom WASM and runs multiplayer over Trac P2P. The renderer uses the upstream WebSocket client; the Node peer proxies WS<->P2P (Hyperswarm/Protomux).

Prereqs
- Place `third_party/doom-wasm/src/doom1.wad` on both peers (sha1 must match).
- Use `ELECTRON_NOGPU=1` for the UI on this box.

Start peers (example ports, one machine)
- Indexer (optional; forwards P2P only):
  - `TRAC_RPC_PORT=7766 node index.js store1`
- Host peer:
  - `TRAC_RPC_PORT=7768 TRAC_DNET_PORT=7788 node index.js store2`
- Join peer:
  - `TRAC_RPC_PORT=7769 TRAC_DNET_PORT=7789 node index.js store4`

Start UIs (each points to its own RPC)
- Host UI: `ELECTRON_NOGPU=1 TRAC_RPC_PORT=7768 TRAC_PLAYERS=2 npm run electron:x11`
- Join UI: `ELECTRON_NOGPU=1 TRAC_RPC_PORT=7769 npm run electron:x11`

Sequence (Chocolate Doom netplay)
- Host: click “Host Game” and wait.
- Joiner: click “Join”. The UI auto-toggles Ready ~1.2s after connect; ensure the joiner stays listed on the host.
- Host: press Space/New Game to launch for everyone.

Health
- Host: `curl http://127.0.0.1:7768/ws/info` → `{ doomClients, metaClients, games, lastGid }`.
- Renderer auto-injects `-wss ws://127.0.0.1:<dnet>/doom` based on `/info`.

Notes
- Indexers skip RPC + dnet; they still forward P2P frames.
- Multi-hop forwarding and WS keep-alives are enabled; Electron background throttling is disabled to avoid idle disconnects.

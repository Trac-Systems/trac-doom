# Trac Doom Final - Production Plan

Notes
- Work only in `/home/muffin/trac-doom-final` (original repo untouched).
- Each topic is a separate milestone; do not start the next until tests pass.
- Archived context: `/home/muffin/trac-doom-final/archive/progress.md`.

Reference delta (Pear v2 / Hypertokens)
- `package.json` uses `pear.pre = "pear-electron/pre"`, `pear.routes = "."`, `pear.type = "desktop"`, `pear-bridge` + `pear-electron` dependencies.
- `index.js` is a minimal runtime entrypoint: starts `pear-bridge` and `pear-electron` runtime, no custom Electron bootstrapping.
- `index.html` loads UI as ESM (`<script type="module" src="./app.js">`) and uses `pear-ctrl` for window controls.
- UI code runs as ESM (no CommonJS `require`), but Node builtins are available via ESM imports (e.g., `import fs from 'fs'`).
- Hypertokens runs peer start from `src/main.js` and imports `app` into UI `app.js`.

A) Native Pear v2 migration (no separate Electron instance)
Goal
- Run UI and peer under Pear v2 runtime using `pear-electron` + `pear-bridge` (single app entry), and remove custom Electron bootstrap.

Plan
- A0: Run modes (terminal indexer vs UI peer)
  - Bootstrap/admin (terminal): `TRAC_RPC_PORT=7768 TRAC_DNET_PORT=7788 node src/main.js --store store1`.
  - Indexer (terminal): start once to get its writer key, add it from bootstrap with `/add_indexer --key <writerKey>`, then restart.
  - UI peer: `pear run -d . --store <storeX>` (starts UI + peer in one process).
  - Host/Join nodes: same as UI peer, with per-node env vars (`TRAC_RPC_PORT`, `TRAC_DNET_PORT`, `TRAC_PLAYERS` for host).
  - Ensure `getStorePath()` supports both Pear v2 `--store` and CLI positional args.
- A1: Restructure entrypoints to match Pear v2 pattern
  - Replace current `index.js` with Pear v2 runtime entry (similar to Hypertokens).
  - Add `app.js` (UI entry) as ESM; `index.html` should load `app.js` as module.
  - Move peer start to `src/main.js` (or similar) and import it into `app.js`.
- A2: Convert renderer code to ESM
  - Replace `window.require` usage in `desktop.js`; rename to `app.js` and use ESM imports (`react`, `htm`, `fs`).
  - Remove `preload.cjs` / Electron-only bootstrapping; rely on Pear UI runtime.
- A3: Align `package.json` with Pear v2
  - Add `pear.pre`, `pear.routes`, `pear.type = desktop`, and GUI config as needed.
  - Add `pear-electron`, `pear-bridge`, and any `bare-*` deps required by runtime.
- A4: Networking compatibility check
  - Validate that WS client (`WebSocket`) works in Pear UI; if not, fall back to `bare-ws` (Holepunch) for WS endpoints.
  - Confirm HTTP RPC usage works; if not, use `pear-bridge` for local HTTP routing.
- A5: Smoke tests
  - Pear UI loads lobby, peer starts, and Doom loads with `-wss` to local bridge.
  - Start bootstrap + indexer in terminal; then two Pear UI peers can host/join across the swarm.

Exit criteria (must pass before B)
- `pear run -d . <store>` launches UI + peer; no Electron scripts are used.
- Host/join works locally with vanilla Doom WS client and bridge.
- No `window.require` usage remains in the UI path.

B) Anti-manipulation (option 4) + channel separation
Goal
- Add signed input envelope + replay protection, and isolate match traffic into per-match channels while keeping a single contract/indexer channel.

Plan
- B1: Define match identity + roster
  - Add `joinGame(gid, uid)` tx: each player self-registers uid->address on-chain (contract enforces `this.address`).
  - Server creates `gid`, records `game/<gid>/server`, and may pin `game/<gid>/maxPlayers`.
  - Roster lives in contract keys `game/<gid>/roster/<uid> = address`.
- B2: Signed input envelope
  - Use Ed25519 signatures over `hash = sha256(gid|uid|seq|payload)`; envelope `{gid, uid, seq, payload, sig}`.
  - Verify signature against roster address; enforce monotonic `seq` per `gid+uid`.
- B3: Separate game transport from contract swarm
  - Keep `trac-peer` swarm for contract replication and indexers.
  - Add a separate `Hyperswarm` for game sessions; each `gid` joins its own topic (`hash(gid)`).
  - Ensure game swarm does NOT call `store.replicate` (pure transport only).
- B4: Bridge updates
  - Update `ws-bridge` to publish/subscribe per-gid game swarm channels only for active matches.
  - Drop any packet without valid signature or roster membership; log rejection reason.
- B5: Observability + abuse controls
  - Add counters for dropped/invalid packets, per-peer rate limits, and audit logs.

Tests
- Unit: signature/MAC verification and replay rejection.
- Integration: two peers cannot spoof uid/address; tampered packets are dropped.
- Scale: 10 concurrent gids do not leak traffic between matches.

Exit criteria (must pass before C)
- Invalid or unsigned packets are rejected.
- Players outside a match do not see its game traffic.
- Indexers only handle contract traffic, not match packets.

C) Frontend: matchmaking, game creation/selection, rankings
Goal
- Production-ready lobby UI with matchmaking, game selection, and rankings.

Plan
Implementation order: C0 -> C2 -> C1 -> C3 -> C4 -> C5 -> C6
- C0: Lobby data model + transport (solve “single lobby”)
  - Data structures (document in code):
    - Presence: `{ address, nick, clientId, status, matchGid, lastSeenMs }`
    - Match: `{ gid, host, wadSha1, mode, noMonsters, maxPlayers, players, status, createdAt, version }`
    - Status enum: `open | full | starting | in_game | ended | stale`
  - Per-match channel requirement:
    - Each match must use its own channel/topic derived from `gid` (random id).
    - Lobby presence + match adverts stay on the base channel; gameplay traffic only on the match channel.
    - This depends on B3 (separate game swarm) but must be surfaced here so UI always uses the correct `gid`.
  - Transport choice:
    - Use the existing P2P meta channel (WS bridge) for ephemeral presence + match adverts (TTL-based).
    - Use contract storage only for durable rankings (not for volatile lobby lists).
  - TTL + refresh:
    - Presence and match adverts must expire if not refreshed within N seconds.
    - Indexer is *not* required to relay lobby presence, but should not break if present.
  - Files to change:
    - `src/doom/ws-bridge.js` (new meta message types: `presence`, `match-announce`, `match-update`, `match-start`, `match-end`)
    - `src/rpc/server.js` (expose `GET /lobby` or `GET /matches` for UI bootstrap if needed)
    - `app.js` (new lobby state manager and timers)

- C2: Match creation + selection (host + join)
  - Create match modal:
    - Options: name (optional), mode, no-monsters, max players, WAD signature, visibility.
    - WAD selection:
      - Default IWAD = current `doom1.wad`.
      - Support env overrides: `TRAC_WAD_DIR`, `TRAC_IWAD`, `TRAC_PWADS` (comma-separated or JSON array).
      - Compute and display WAD hash; use hash matching for join validation.
      - PWAD support via `-file` with a deterministic order.
      - Folder scanning UI:
        - Select a WAD folder (path input + browse).
        - Periodically scan for `.wad` files and list IWAD/PWAD options.
        - Store folder + selections in localStorage.
        - Hash matching uses per-file content hashes; filenames are display-only and sanitized.
        - Join validation:
          - If host uses bundled IWAD + no PWADs, join works without a folder.
          - If host uses custom WAD/PWADs, require folder and hash match.
    - Map selection:
      - Use `-warp` (not `-episode`) for explicit map choice.
      - Map picker should adapt to IWAD type (E#M# vs MAP##).
    - Validate WAD hash locally before advertising match.
  - Join flow:
    - On join click, send `match-join` request to host over meta channel.
    - Host validates capacity + settings; replies `accepted/denied`.
    - On accept, subscribe to the match channel/topic derived from `gid` and stop listening to other match traffic.
    - Optimistic UI with rollback if denied.
  - Match lifecycle:
    - Host advertises `open -> starting -> in_game -> ended`.
    - When game starts, broadcast `match-start` and remove from list.
    - On end/abort, broadcast `match-end` so all clients can return to lobby.
  - Files to change:
    - `src/doom/ws-bridge.js` (new meta messages and match state routing)
    - `app.js` (join/host flows, state machine)

- C1: Matchmaking + Lobby UX (end-to-end flow)
  - Player list:
    - Show live player presence: nick, short address, status (“idle / in-match / host / joining”).
    - Always show direct peers, but render hop-peers too when presence arrives.
  - Chat (single-line, no emojis):
    - Use trac-peer message API for lobby chat; sanitize to ASCII, max length (e.g., 200), single line.
    - Display newest first + “load more” pagination (avoid infinite growth).
    - Show system messages for joins/leaves and match events.
  - Match list:
    - Card/table layout with: WAD hash (short), mode, no-monsters, players count, host nick, created time, status.
    - “Join” button per match; reject if full or stale; show reason if join fails.
    - Remove “in_game” matches from list (or move to a “live” section).
  - Quick Match:
    - Optional “Quick Match” button that auto-joins best open match matching mode/WAD.
  - Files to change:
    - `app.js` (new lobby UI + state, chat, match list)
    - `index.html` (layout, base styles)
    - Add `src/ui/*` modules (lobby store, chat, match list, roster)

- C3: Game view + return-to-lobby (no app restart)
  - “Leave match” button for players; “End match” for host.
  - On leave/end:
    - Tear down Doom runtime cleanly (remove canvas, clear timers, reset Module).
    - Return to lobby UI without reloading the whole app.
  - Error recovery:
    - If RPC/WS errors, show inline banner and offer “Retry” + “Back to Lobby”.
  - Files to change:
    - `app.js` (game lifecycle state machine + cleanup)
    - Potential helper module: `src/ui/game-runtime.js`

- C4: Layout + scaling (production-ready visuals)
  - Window + layout:
    - Increase default Pear window size and min size.
    - Grid layout: left column (players), center (matches + create), right (chat + rankings).
  - Canvas scaling:
    - Make Doom canvas responsive to window size; maintain 4:3 aspect with letterboxing.
    - Use `ResizeObserver` to update canvas size in real time.
  - Look & feel:
    - Define CSS variables for colors/typography; remove cluttered inline styles.
    - Clear hierarchy: header, status bar, match actions, chat input docked bottom-right.
  - Files to change:
    - `index.html` (layout shell + styles)
    - `app.js` (component layout + canvas wrapper)
    - `package.json` (pear.gui width/height/min sizes)

- C5: Rankings + history
  - Rankings tabs:
    - Per-mode (deathmatch/altdeath/coop) + all-time.
    - Sort by kills; show top N with pagination.
  - Match history:
    - Show recent match list with gid, mode, date, and winner.
  - Performance:
    - Indexer-side aggregation to avoid scanning full `klog` each time.
  - Files to change:
    - `contract/contract.js` + `contract/protocol.js` (ensure per-mode counters + match record)
    - `src/rpc/server.js` (ranking endpoints)
    - `app.js` (ranking UI)

- C6: QA + definition of done
  - Manual flows (multi-machine):
    - Host + join + cancel + end + rejoin.
    - “Quick match” and “Join full match” error cases.
    - WAD mismatch handling.
  - UI/UX checks:
    - Resizes correctly; no overflow; lobby returns after match.
    - Match list updates within TTL; stale entries disappear.
  - Observability:
    - Add structured console logs for match lifecycle events.
    - Add a log verbosity toggle (e.g., `TRAC_LOG_LEVEL` or `TRAC_QUIET`) to silence noisy ws-bridge/app logs in production.
  - Runbook:
    - Update README with clear, end-to-end commands for:
      - default IWAD usage,
      - custom IWAD via `TRAC_WAD_DIR` + `TRAC_IWAD`,
      - PWAD usage via `TRAC_PWADS`,
      - map selection via `-warp` (UI + CLI).

Checklist (mark each item only after tests pass, in implementation order)
- [x] Lobby shows live player presence (direct + hop) with TTL expiry.
- [x] WAD selection works (default IWAD + `TRAC_WAD_DIR`/`TRAC_IWAD` override) and hash mismatch blocks join.
- [x] PWAD support works (`TRAC_PWADS`), and ordering is deterministic across peers.
- [x] Map selection uses `-warp` and syncs all players on the same map.
- [x] Create/Join flows work; full matches reject with clear error.
- [x] Match start/stop broadcasts work; matches disappear when in-game/ended.
- [x] Match list shows accurate metadata (wad/mode/players) and updates live.
- [x] Chat supports single-line ASCII, max length, and paginated history.
- [x] “Leave match” returns to lobby without restarting app.
- [x] Doom canvas scales to window size with 4:3 letterboxing.
- [x] Rankings tabs load quickly and match contract counters.
- [x] Multi-machine test: host + join + end works twice in a row.
- [ ] README runbook covers default IWAD, custom IWAD, PWADs, and map selection.

Exit criteria
- Lobby is usable without restarts; match creation/join is reliable.
- Visuals are clean, readable, and scale across window sizes.
- Rankings and match history are consistent and performant.

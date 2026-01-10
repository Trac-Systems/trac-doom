# Trac Doom™

<img width="2541" height="1325" alt="doom" src="https://github.com/user-attachments/assets/03769092-1e68-485f-9980-de9da483a964" />

A peer-to-peer Doom netplay app with smart-contract backed stats (kills, rankings, achievements).

Play classic Doom™ with friends online without setting up port-forwarding. Deathmatch, Co-op supported.

Trac Doom™ ships with Freedoom 1 + 2 and allows to use your own custom WADs (maps) that are compatible with Doom1 and 
Doom2.

Trac Doom™ is a pure gaming experience. No financial transactions are involved.

## Controls

WASD + Mouse (or arrow keys + spacebar for shoot)

1,2,3... for weapon switching.

"F" key for fullscreen. "ESC" to minimize.

## Installation

Windows: download & install: https://github.com/Trac-Systems/trac-doom/releases/download/0.1.0/TracDoom.msix 

Mac: download & unzip and run: https://github.com/Trac-Systems/trac-doom/releases/download/0.1.0/TracDoom.zip

All installables are signed by us!

After first installation you may need to type the word TRUST anc confirm.
Once done, restart the app again.

If chat or match making/joining doesn't work after the first start, please restart the app!

For Linux see source install below (works also for Windows & Mac).

## Install Node.js and Pear

Node.js 22+ required:

Windows:
- Option 1 (installer): Download and run the Node.js 22+ installer from https://nodejs.org/
- Option 2 (winget):
```powershell
winget install OpenJS.NodeJS
```

macOS:
- Option 1 (Homebrew):
```bash
brew install node
```
- Option 2 (installer): Download the installer from https://nodejs.org/

Linux:
- Option 1 (NodeSource, Debian/Ubuntu):
```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
```
- Option 2 (nvm, any distro):
```bash
curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
export NVM_DIR="$HOME/.nvm"
source "$NVM_DIR/nvm.sh"
nvm install 22
nvm use 22
```

Verify Node (must be 22+):
```bash
node -v
npm -v
```

Pear (v2+ required):
```bash
npm install -g pear
```

Check Pear version:
```bash
pear -v
```
If the version is below 2.x, upgrade Pear:
```bash
pear sidecar --key pzcjqmpoo6szkoc4bpkw65ib9ctnrq7b6mneeinbhbheihaq6p6o
```

## Install & Run

Option A: Run the packaged release

macOS / Linux:
```bash
pear run pear://6y6ipdm9wanepy7tcii8hu1cixwbzchskwtc9pg1czjayr7f564y gamedata
```

Windows (PowerShell):
```powershell
pear run pear://6y6ipdm9wanepy7tcii8hu1cixwbzchskwtc9pg1czjayr7f564y gamedata
```

Windows (cmd):
```cmd
pear run pear://6y6ipdm9wanepy7tcii8hu1cixwbzchskwtc9pg1czjayr7f564y gamedata
```

"gamedata" will be the folder containing your identity. Please keep it at all times to preserve your achievements!

## Install & Run (from source)

Option B: Clone the repo and run locally

macOS / Linux:
```bash
git clone https://github.com/Trac-Systems/trac-doom
cd trac-doom
npm install
pear run . gamedata
```

Windows (PowerShell):
```powershell
git clone https://github.com/Trac-Systems/trac-doom
cd trac-doom
npm install
pear run . gamedata
```

Windows (cmd):
```cmd
git clone https://github.com/Trac-Systems/trac-doom
cd trac-doom
npm install
pear run . gamedata
```

Notes:
- `gamedata` is the storage folder. Use a different folder per local peer.
- `-d` opens devtools. You can omit it for normal play.

## In‑Lobby & In‑Game Options

Lobby:
- Nickname: Your public display name in chat and rankings.
- Players: Connected peers (nicknames are pulled from the contract).
- Chat: Single‑line text chat shared on the contract channel.
- Match list: Open matches; click Join to request a slot.
- Host game: Creates a match with the selected settings.
- Mode: Coop / Deathmatch / Altdeath.
- Max players: 1–4 (Doom netplay limit).
- Map + Skill: Map selection and difficulty.
- No monsters: Removes monsters (useful for competitive modes).
- MAP Settings: IWAD/PWAD selection and hashes (see below).

In‑game:
- End match (host): Stops the match for everyone.
- Leave match (joiner): Leaves before the match starts.

## WADs & PWADs

Terminology:
- **IWAD**: Base game content (e.g., Doom or Freedoom).
- **PWAD**: Add‑on content (maps, weapons, total conversions).

Defaults:
- Bundled IWADs: `doom1.wad` (Freedom1) and `doom2.wad` (Freedom2).
- You can always host with bundled IWADs.

Custom WADs:
- Open **MAP Settings** and set a WAD folder.
- The app scans for `.wad` files and lists IWADs and PWADs separately.
- Joiners must have matching file hashes for the selected IWAD/PWADs or the UI blocks the join.

## Parameters

Common env vars:
- `TRAC_RPC_PORT` (default `7767`) – UI RPC port.
- `TRAC_DNET_PORT` (default `7788`) – Doom WS bridge port.
- `TRAC_PLAYERS` (default `2`) – Max players (1–4).
- `TRAC_SKILL` (default `3`) – Doom skill (1–5).
- `TRAC_WAD_DIR` – Folder to scan for WAD/PWADs.
- `TRAC_IWAD` – Default IWAD filename in the folder.
- `TRAC_PWADS` – Comma‑separated PWAD filenames.
- `TRAC_SOUND` (`1`/`0`) – Sound effects on/off (default on).
- `TRAC_MUSIC` (`1`/`0`) – Music on/off (default off).

Use env vars the same way for both:
- the packaged Pear URI (`pear run ... pear://...`)
- the local repo (`pear run ... .`)

macOS / Linux (packaged):
```bash
TRAC_RPC_PORT=7769 TRAC_DNET_PORT=7789 TRAC_PLAYERS=2 pear run pear://6y6ipdm9wanepy7tcii8hu1cixwbzchskwtc9pg1czjayr7f564y store_host
```

macOS / Linux (local repo):
```bash
TRAC_RPC_PORT=7769 TRAC_DNET_PORT=7789 TRAC_PLAYERS=2 pear run . store_host
```

Windows (PowerShell, packaged):
```powershell
$env:TRAC_RPC_PORT=7769
$env:TRAC_DNET_PORT=7789
$env:TRAC_PLAYERS=2
pear run pear://6y6ipdm9wanepy7tcii8hu1cixwbzchskwtc9pg1czjayr7f564y store_host
```

Windows (PowerShell, local repo):
```powershell
$env:TRAC_RPC_PORT=7769
$env:TRAC_DNET_PORT=7789
$env:TRAC_PLAYERS=2
pear run . store_host
```

Windows (cmd, packaged):
```cmd
set TRAC_RPC_PORT=7769&& set TRAC_DNET_PORT=7789&& set TRAC_PLAYERS=2&& pear run pear://6y6ipdm9wanepy7tcii8hu1cixwbzchskwtc9pg1czjayr7f564y store_host
```

Windows (cmd, local repo):
```cmd
set TRAC_RPC_PORT=7769&& set TRAC_DNET_PORT=7789&& set TRAC_PLAYERS=2&& pear run . store_host
```

## Third‑Party Licenses

- Doom WASM (third_party/doom-wasm) is licensed under GPLv2. See `third_party/doom-wasm/COPYING.md`.
- Freedoom IWADs (Freedom1/doom1.wad, Freedom2/doom2.wad) are from the Freedoom project and licensed under the BSD 3‑Clause. See https://freedoom.github.io/.


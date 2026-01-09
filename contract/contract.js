import {Contract} from 'trac-peer'

const ACH_OG_LIMIT = 3000
const ACH_SPREE_THRESHOLDS = [10, 15, 20, 30, 40, 50, 60, 70, 85, 100]

class SampleContract extends Contract {
    /**
     * Extending from Contract inherits its capabilities and allows you to define your own contract.
     * The contract supports the corresponding protocol. Both files come in pairs.
     *
     * Instances of this class run in contract context. The constructor is only called once on Peer
     * instantiation.
     *
     * Please avoid using the following in your contract functions:
     *
     * No try-catch
     * No throws
     * No random values
     * No http / api calls
     * No super complex, costly calculations
     * No massive storage of data.
     * Never, ever modify "this.op" or "this.value", only read from it and use safeClone to modify.
     * ... basically nothing that can lead to inconsistencies akin to Blockchain smart contracts.
     *
     * Running a contract on Trac gives you a lot of freedom, but it comes with additional responsibility.
     * Make sure to benchmark your contract performance before release.
     *
     * If you need to inject data from "outside", you can utilize the Feature class and create your own
     * oracles. Instances of Feature can be injected into the main Peer instance and enrich your contract.
     *
     * In the current version (Release 1), there is no inter-contract communication yet.
     * This means it's not suitable yet for token standards.
     * However, it's perfectly equipped for interoperability or standalone tasks.
     *
     * this.protocol: the peer's instance of the protocol managing contract concerns outside of its execution.
     * this.options: the option stack passed from Peer instance
     *
     * @param protocol
     * @param options
     */
    constructor(protocol, options = {}) {
        // calling super and passing all parameters is required.
        super(protocol, options);

        // Record kills as contract transactions (strict, server-authoritative)
        this.addSchema('recordKill', {
            value : {
                $$strict : true,
                $$type : "object",
                op : { type : "string", enum : ["record_kill"] },
                gid : { type : "string", min : 8, max : 128 },
                seq : { type : "number", integer: true, min: 1 },
                // ed25519 hex addresses are 64 chars; allow 64-80
                killer : { type : "string", min : 32, max : 80 },
                victim : { type : "string", min : 32, max : 80 }
            }
        });

        // Start/end a game session (register server and enforce authority)
        this.addSchema('startGame', {
            value : {
                $$strict : true,
                $$type : "object",
                op : { type : "string", enum : ["start_game"] },
                gid : { type : "string", min : 8, max : 128 },
                server : { type : "string", min : 32, max : 80 },
                mode : { type : "string", optional: true, enum : ["coop", "deathmatch", "altdeath"] },
                maxPlayers : { type: "number", integer: true, optional: true, min: 1, max: 4 }
            }
        });
        this.addSchema('endGame', {
            value : {
                $$strict : true,
                $$type : "object",
                op : { type : "string", enum : ["end_game"] },
                gid : { type : "string", min : 8, max : 128 }
            }
        });
        this.addSchema('joinGame', {
            value : {
                $$strict : true,
                $$type : "object",
                op : { type : "string", enum : ["join_game"] },
                gid : { type : "string", min : 8, max : 128 },
                uid : { type : "number", integer: true, min: 1 }
            }
        });

        // in preparation to add an external Feature (aka oracle), we add a loose schema to make sure
        // the Feature key is given properly. it's not required, but showcases that even these can be
        // sanitized.
        this.addSchema('feature_entry', {
            key : { type : "string", min : 1, max: 256 },
            value : { type : "any" }
        });

        // now we are registering the timer feature itself (see /features/time/ in package).
        // note the naming convention for the feature name <feature-name>_feature.
        // the feature name is given in app setup, when passing the feature classes.
        const _this = this;

        // this feature registers incoming data from the Feature and if the right key is given,
        // stores it into the smart contract storage.
        // the stored data can then be further used in regular contract functions.
        this.addFeature('timer_feature', async function(){
            if(false === _this.validateSchema('feature_entry', _this.op)) return;
            if(_this.op.key === 'currentTime') {
                if(null === await _this.get('currentTime')) console.log('timer started at', _this.op.value);
                await _this.put(_this.op.key, _this.op.value);
            }
        });

        // last but not least, you may intercept messages from the built-in
        // chat system, and perform actions similar to features to enrich your
        // contract. check the _this.op value after you enabled the chat system
        // and posted a few messages.
        this.messageHandler(async function(){
            console.log('message triggered contract', _this.op);
        });
    }

    async _getInt(key, fallback = 0) {
        let val = await this.get(key);
        if (val === null || val === undefined) return fallback;
        val = parseInt(val);
        return isNaN(val) ? fallback : val;
    }

    async _touchMatchPlayer(gid, addr) {
        const seenKey = 'match_player/' + gid + '/' + addr;
        const seen = await this.get(seenKey);
        if (seen !== null) return;
        await this.put(seenKey, 1);
        const lenKey = 'match_players_len/' + gid;
        const listKey = 'match_players/' + gid + '/';
        const len = await this._getInt(lenKey, 0);
        await this.put(listKey + len, addr);
        await this.put(lenKey, len + 1);
    }

    async _incMatchStat(prefix, gid, addr, delta = 1) {
        const key = prefix + '/' + gid + '/' + addr;
        const cur = await this._getInt(key, 0);
        await this.put(key, cur + delta);
    }

    async _awardAchievement(addr, id, title, delta = 1) {
        const defKey = 'ach_defs/' + id;
        if (await this.get(defKey) === null) {
            await this.put(defKey, { title });
        }

        const achKey = 'ach/' + addr + '/' + id;
        const existing = await this.get(achKey);
        const firstTime = existing === null;
        const currentCount = existing && typeof existing.count === 'number'
            ? existing.count
            : (existing && typeof existing.count === 'string' ? parseInt(existing.count) : 0);

        if (firstTime) {
            const ownersLenKey = 'ach_owners_len/' + id;
            const ownersListKey = 'ach_owners/' + id + '/';
            const ownersLen = await this._getInt(ownersLenKey, 0);
            await this.put(ownersListKey + ownersLen, addr);
            await this.put(ownersLenKey, ownersLen + 1);

            const listKey = 'ach_list/' + addr;
            let list = await this.get(listKey);
            if (!Array.isArray(list)) list = [];
            if (!list.includes(id)) {
                list.push(id);
                await this.put(listKey, list);
            }
        }

        await this.put(achKey, { title, count: currentCount + delta });
    }

    async _maybeAwardOg(addr) {
        const seenKey = 'ach_seen/' + addr;
        const seen = await this.get(seenKey);
        if (seen !== null) return;
        const countKey = 'ach_og_count';
        const count = await this._getInt(countKey, 0);
        if (count >= ACH_OG_LIMIT) return;
        await this.put(seenKey, 1);
        await this.put(countKey, count + 1);
        await this._awardAchievement(addr, 'og', 'OG');
    }

    /**
     * Records a kill in the contract state (server-authoritative).
     * Requires an active game gid and strictly monotonic seq.
     * Stores cumulative kills per killer address at key `kills/<address>` and per-game at `kills/<gid>/<address>`.
     * Appends a compact log at `klog/<n>` for history/auditing.
     */
    async recordKill(){
        const gid = ''+this.value.gid;
        // enforce server authority
        const serverAddr = await this.get('game/'+gid+'/server');
        if (serverAddr === null) return;
        if (''+serverAddr !== this.address) return;
        const active = await this.get('game/'+gid+'/active');
        if (!(active === 1 || active === '1')) return;
        // seq enforcement
        let lastSeq = await this.get('game/'+gid+'/seq');
        lastSeq = lastSeq === null ? 0 : parseInt(lastSeq);
        const seq = parseInt(this.value.seq);
        if (isNaN(seq)) return;
        if (seq !== lastSeq + 1) return;
        await this.put('game/'+gid+'/seq', seq);

        const killer = ''+this.value.killer;
        const victim = ''+this.value.victim;
        const rawMode = await this.get('game/'+gid+'/mode');
        const mode = (rawMode === 'altdeath' || rawMode === 'deathmatch') ? rawMode : (rawMode === 'coop' ? 'coop' : 'deathmatch');
        await this._maybeAwardOg(killer);
        await this._maybeAwardOg(victim);
        if (mode === 'coop') return;
        await this._touchMatchPlayer(gid, killer);
        await this._touchMatchPlayer(gid, victim);
        await this._incMatchStat('match_kills', gid, killer, 1);
        await this._incMatchStat('match_deaths', gid, victim, 1);

        const firstBloodKey = 'match_first_blood/' + gid;
        const firstBlood = await this.get(firstBloodKey);
        if (firstBlood === null) {
            await this.put(firstBloodKey, killer);
            await this._awardAchievement(killer, 'first_blood', 'First Blood');
        }
        const modeKey = 'kills_mode/' + mode + '/' + killer;
        // increment global counter
        const key = 'kills/'+killer;
        let count = await this._getInt(key, 0);
        await this.put(key, count + 1);
        let mcount = await this._getInt(modeKey, 0);
        await this.put(modeKey, mcount + 1);
        // increment per-game counter
        const gkey = 'kills/'+gid+'/'+killer;
        let gcount = await this._getInt(gkey, 0);
        await this.put(gkey, gcount + 1);
        // append log
        let len = await this._getInt('klogl', 0);
        await this.put('klog/'+len, { gid, seq, killer, victim, mode, ts: await this.get('currentTime') });
        await this.put('klogl', len + 1);
    }

    async startGame(){
        const gid = ''+this.value.gid;
        const server = ''+this.value.server;
        const rawMode = this.value.mode ? ''+this.value.mode : 'deathmatch';
        const mode = (rawMode === 'coop' || rawMode === 'altdeath') ? rawMode : 'deathmatch';
        const maxPlayersRaw = this.value.maxPlayers;
        const maxPlayers = (maxPlayersRaw !== undefined && maxPlayersRaw !== null)
            ? parseInt(maxPlayersRaw)
            : null;
        const exists = await this.get('game/'+gid+'/server');
        if (exists !== null) return;
        const lockKey = 'server_active/' + server;
        const prev = await this.get(lockKey);
        const prevGid = (prev && typeof prev === 'string') ? prev : (prev ? ''+prev : '');
        if (prevGid && prevGid !== gid) {
            await this.put('game/'+prevGid+'/active', 0);
        }
        await this.put('game/'+gid+'/server', server);
        await this.put('game/'+gid+'/active', 1);
        await this.put('game/'+gid+'/seq', 0);
        await this.put('game/'+gid+'/mode', mode);
        if (Number.isFinite(maxPlayers) && maxPlayers > 0) {
            await this.put('game/'+gid+'/maxPlayers', Math.min(4, Math.max(1, maxPlayers)));
        }
        await this.put(lockKey, gid);
    }

    async joinGame(){
        const gid = ''+this.value.gid;
        const uid = parseInt(this.value.uid);
        if (isNaN(uid) || uid <= 0) return;
        const serverAddr = await this.get('game/'+gid+'/server');
        if (serverAddr === null) return;
        const active = await this.get('game/'+gid+'/active');
        if (!(active === 1 || active === '1')) return;

        const addr = ''+this.address;
        const rosterKey = 'game/'+gid+'/roster/'+uid;
        const existing = await this.get(rosterKey);
        if (existing !== null && (''+existing) !== addr) return;

        const maxPlayers = await this._getInt('game/'+gid+'/maxPlayers', 0);
        const addrKey = 'game/'+gid+'/roster_addr/'+addr;
        const prevUid = await this.get(addrKey);
        const hasAddr = prevUid !== null && prevUid !== undefined && String(prevUid).length > 0;
        if (maxPlayers > 0 && !hasAddr) {
            const rosterLen = await this._getInt('game/'+gid+'/roster_len', 0);
            if (rosterLen >= maxPlayers) return;
        }

        if (hasAddr && String(prevUid) !== String(uid)) {
            await this.put('game/'+gid+'/roster_active/'+prevUid, 0);
        }
        if (existing === null) {
            await this.put(rosterKey, addr);
        }
        await this.put('game/'+gid+'/roster_active/'+uid, 1);
        if (!hasAddr) {
            const rosterLen = await this._getInt('game/'+gid+'/roster_len', 0);
            await this.put('game/'+gid+'/roster_len', rosterLen + 1);
        }
        await this.put(addrKey, uid);
    }

    async endGame(){
        const gid = ''+this.value.gid;
        const serverAddr = await this.get('game/'+gid+'/server');
        if (serverAddr === null) return;
        if (''+serverAddr !== this.address) return;
        await this.put('game/'+gid+'/active', 0);
        const lockKey = 'server_active/' + this.address;
        const current = await this.get(lockKey);
        const currentGid = (current && typeof current === 'string') ? current : (current ? ''+current : '');
        if (currentGid && currentGid === gid) {
            await this.put(lockKey, '');
        }

        const rawMode = await this.get('game/'+gid+'/mode');
        const mode = (rawMode === 'altdeath' || rawMode === 'deathmatch') ? rawMode : (rawMode === 'coop' ? 'coop' : 'deathmatch');
        if (mode === 'deathmatch' || mode === 'altdeath') {
            const lenKey = 'match_players_len/' + gid;
            const len = await this._getInt(lenKey, 0);
            for (let i = 0; i < len; i++) {
                const addr = await this.get('match_players/' + gid + '/' + i);
                if (!addr) continue;
                const kills = await this._getInt('match_kills/' + gid + '/' + addr, 0);
                const deaths = await this._getInt('match_deaths/' + gid + '/' + addr, 0);

                let spreeLevel = 0;
                for (let j = 0; j < ACH_SPREE_THRESHOLDS.length; j++) {
                    if (kills >= ACH_SPREE_THRESHOLDS[j]) spreeLevel = j + 1;
                }
                if (spreeLevel > 0) {
                    await this._awardAchievement(addr, 'spree_' + spreeLevel, 'Killing Spree L' + spreeLevel);
                }

                if (kills >= 20 && deaths === 0) {
                    await this._awardAchievement(addr, 'untouchable', 'Untouchable');
                }

                if (deaths >= 3 && kills >= (deaths + 5)) {
                    await this._awardAchievement(addr, 'comeback', 'Comeback');
                }
            }
        }
    }
}

export default SampleContract;

import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  parsePwads,
  resolveWadConfig,
  readWadFiles,
  parseWarpInput,
  hashWadEntries
} from '../src/ui/wad.js'

function assert (cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed')
}

async function main () {
  assert(parsePwads('a.wad,b.wad').length === 2, 'parsePwads comma')
  assert(parsePwads('["a.wad","b.wad"]').length === 2, 'parsePwads json')
  assert(parsePwads('  ').length === 0, 'parsePwads empty')

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wadtest-'))
  const iwadPath = path.join(tmp, 'doom1.wad')
  const pwadA = path.join(tmp, 'a.wad')
  const pwadB = path.join(tmp, 'b.wad')
  fs.writeFileSync(iwadPath, Buffer.from('IWAD'))
  fs.writeFileSync(pwadA, Buffer.from('PWAD-A'))
  fs.writeFileSync(pwadB, Buffer.from('PWAD-B'))

  const cfg = resolveWadConfig({ TRAC_WAD_DIR: tmp, TRAC_IWAD: 'doom1.wad', TRAC_PWADS: 'a.wad,b.wad' }, tmp)
  assert(cfg.errors.length === 0, 'resolveWadConfig errors')
  const data = await readWadFiles(cfg)
  assert(data.hash && data.hash.length === 40, 'hash length')

  const cfgRev = resolveWadConfig({ TRAC_WAD_DIR: tmp, TRAC_IWAD: 'doom1.wad', TRAC_PWADS: 'b.wad,a.wad' }, tmp)
  const dataRev = await readWadFiles(cfgRev)
  assert(dataRev.hash !== data.hash, 'hash should differ when PWAD order changes')

  const warp1 = parseWarpInput('E2M3')
  assert(warp1.args && warp1.args.join(' ') === '-warp 2 3', 'warp E2M3')
  const warp2 = parseWarpInput('MAP07')
  assert(warp2.args && warp2.args.join(' ') === '-warp 7', 'warp MAP07')
  const warp3 = parseWarpInput('2 4')
  assert(warp3.args && warp3.args.join(' ') === '-warp 2 4', 'warp 2 4')
  const warp4 = parseWarpInput('12')
  assert(warp4.args && warp4.args.join(' ') === '-warp 12', 'warp 12')
  const warpBad = parseWarpInput('nope')
  assert(warpBad.error, 'warp invalid')

  const h1 = hashWadEntries([{ name: 'x.wad', buf: Buffer.from('1') }])
  const h2 = hashWadEntries([{ name: 'x.wad', buf: Buffer.from('1') }])
  assert(h1 === h2, 'hash deterministic')

  console.log('OK: wad-utils tests passed')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

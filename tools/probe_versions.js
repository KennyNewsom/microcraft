// Exercise actual 26.2 wire translation without requiring a second paid account.
// A 26.1 test client -> ViaProxy (target 26.2) -> Microcraft ViaProxy -> 26.1 backend.
const fs = require('node:fs')
const path = require('node:path')
const net = require('node:net')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
const assert = require('node:assert/strict')
const mc = require('minecraft-protocol')
const crypto = require('node:crypto')
const { concat } = require('minecraft-protocol/src/transforms/binaryStream')
const { messageBytes } = require('../host/chat')
const { createGame } = require('../host/minecraft')
const { identityService, installIdentity, startProxy, javaExecutable } = require('../host/compatibility')
const root = path.resolve(__dirname, '..')
async function freePort () {
  const server = net.createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const port = server.address().port; await new Promise(r => server.close(r)); return port
}
async function ready (port, child) {
  for (let i = 0; i < 150; i++) {
    if (child.exitCode !== null) throw new Error('Proxy exited during startup')
    if (await new Promise(r => { const s = net.connect(port, '127.0.0.1'); s.on('connect', () => { s.destroy(); r(true) }); s.on('error', () => r(false)) })) return
    await new Promise(r => setTimeout(r, 100))
  }
  throw new Error('Proxy startup timeout')
}
async function main () {
  const identity = await identityService(false)
  const fake = require('../tests/helpers/fake-mcu').fakeMCU()
  const statePalette = require('../host/data/states.json')
  const exampleStates = ['oak_door','stone_stairs','redstone_wire'].map(name => {
    const g=statePalette.groups.find(g=>g.name===name); return g.start+g.count-1
  })
  const rpc = async (op,p) => {
    const result = await fake.rpc(op,p)
    if(op!==22) return result
    const wide=Buffer.alloc(65536); result.forEach((v,i)=>wide.writeUInt16LE(v,i*2))
    exampleStates.forEach((v,x)=>wide.writeUInt16LE(v,((2*16+x)*128+8)*2))
    return wide
  }
  const server = createGame(rpc, null, { port: 0,
    beforeLogin: c => { c.uuid = c.forwardedProfile.uuid; c.profile = { properties: c.forwardedProfile.properties } } })
  installIdentity(server, identity)
  const ca = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
  const keys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
  server.on('login', c => { c.microcraftChat.authority = ca.publicKey })
  const children = []; const clients = []
  const timeout = setTimeout(() => { console.error('Version probe timed out'); children.forEach(c => c.kill()); clients.forEach(c => c.end('Timeout')); server.close(); identity.service.closeAllConnections(); identity.service.close(); process.exitCode = 1 }, 45000)
  try {
    await once(server, 'listening')
    const front = await freePort(); const reverse = await freePort()
    const proxy = startProxy({ host: '127.0.0.1', port: front, onlineMode: false }, server.socketServer.address().port, identity, e => console.error(e.message))
    children.push(proxy); await ready(front, proxy)
    const dir = fs.mkdtempSync(path.join(root, '.tools', 'version-probe-'))
    fs.mkdirSync(path.join(dir, 'plugins'))
    fs.copyFileSync(path.join(root, '.tools/viaproxy/plugins/MicrocraftIdentity.jar'), path.join(dir, 'plugins/MicrocraftIdentity.jar'))
    fs.writeFileSync(path.join(dir, 'probe.yml'), `bind-address: 127.0.0.1:${reverse}\ntarget-address: 127.0.0.1:${front}\ntarget-version: '26.2'\nproxy-online-mode: false\nauth-method: NONE\n`)
    const backwards = spawn(javaExecutable(), ['-Xmx256m', '-jar', path.join(root, '.tools/viaproxy/ViaProxy-3.4.12.jar'), 'config', 'probe.yml'], { cwd: dir, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    backwards.stdout.pipe(process.stdout); backwards.stderr.pipe(process.stderr)
    children.push(backwards); await ready(reverse, backwards)
    for (const port of [front, reverse]) {
      const status = await mc.ping({ host: '127.0.0.1', port, version: '26.1' })
      assert.equal(status.favicon, require('../host/server-icon').iconProvider()())
    }
    const connect = (port, name) => { const c = mc.createClient({ host: '127.0.0.1', port, version: '26.1', username: name, auth: 'offline' }); c.on('error', e => { if (e.code !== 'ECONNRESET') console.error(e) }); clients.push(c); return c }
    const a = connect(front, 'VersionOne'); await once(a, 'position')
    const peer = once(a, 'spawn_entity')
    const b = connect(reverse, 'VersionTwo'); const metadata = []; b.on('entity_metadata', p => metadata.push(p))
    let checkedWide=false
    b.on('map_chunk', p => {
      if(checkedWide) return
      const chunk=new (require('prismarine-chunk')('26.1'))(); chunk.load(p.chunkData)
      exampleStates.forEach((id,x)=>assert.equal(chunk.getBlockStateId({x,y:8,z:2}),statePalette.states[id].state))
      checkedWide=true
    })
    if (process.env.PROBE_DEBUG) b.on('packet', (p, meta) => console.log('probe packet', meta.name))
    await once(b, 'position'); await peer
    assert.ok(checkedWide, 'Powered and rotated states survive the 26.2 wire path')
    const moved = once(a, 'sync_entity_position')
    b.write('position', { x: 18, y: 10, z: 17, flags: {} }); assert.equal((await moved)[0].z, 17)
    const block = once(b, 'block_change')
    b.write('block_dig', { status: 0, location: { x: 18, y: 7, z: 17 }, face: 1, sequence: 1 })
    assert.equal((await block)[0].type, 0)
    assert.ok(metadata.some(p => p.metadata.some(m => m.key === 16 && m.value === 127)))
    const certificate = { sessionUUID: crypto.randomUUID(), expireTime: BigInt(Date.now() + 3600000), publicKey: keys.publicKey.export({ type: 'spki', format: 'der' }) }
    certificate.signature = crypto.sign('RSA-SHA1', concat('UUID', b.uuid, 'i64', certificate.expireTime, 'buffer', certificate.publicKey), ca.privateKey)
    const session = once(a, 'player_info'); b.write('chat_session_update', certificate); await session
    const packet = { message: 'Signed chat through 26.2', timestamp: BigInt(Date.now()), salt: 42n, offset: 0, acknowledged: Buffer.alloc(3), checksum: 1 }
    packet.signature = crypto.sign('RSA-SHA256', messageBytes(b.uuid, certificate.sessionUUID, 0, packet, []), keys.privateKey)
    const received = once(a, 'playerChat'); const echo = once(b, 'playerChat')
    b.write('chat_message', packet)
    assert.equal((await received)[0].verified, true); assert.equal((await echo)[0].verified, true)
    console.log('PASS: concurrent 26.1 and translated 26.2 wire paths: chunks, entities, movement, block edits, skin layers and cryptographically verified chat.')
  } finally {
    clearTimeout(timeout)
    clients.forEach(c => c.end('Done')); Object.values(server.clients).forEach(c => c.end('Done'))
    server.close(); identity.service.closeAllConnections(); identity.service.close()
    for (const child of children) child.kill()
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })

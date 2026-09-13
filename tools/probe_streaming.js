'use strict'
// Read-only, two-client test against a running bridge. No blocks are edited.
const mc = require('minecraft-protocol')
const assert = require('node:assert/strict')
const { once } = require('node:events')
const crypto = require('node:crypto')

async function main () {
  const clients = []
  const timeout = setTimeout(() => { console.error('Streaming probe timeout'); process.exit(1) }, 180000)
  const connect = name => {
    const c = mc.createClient({ host: process.env.MICROCRAFT_TEST_HOST || '127.0.0.1', port: 25565,
      username: name, auth: 'offline', version: '26.1' })
    c.chunks = new Map(); c.unloads = 0
    c.on('map_chunk', p => c.chunks.set(`${p.x},${p.z}`, crypto.createHash('sha256').update(p.chunkData).digest('hex')))
    c.on('unload_chunk', p => { c.unloads++; c.chunks.delete(`${p.chunkX},${p.chunkZ}`) })
    c.on('position', p => c.write('teleport_confirm', { teleportId: p.teleportId }))
    c.on('error', err => console.error(err.message))
    c.on('kick_disconnect', p => console.error('Kicked:', JSON.stringify(p)))
    clients.push(c); return c
  }
  try {
    const start = Date.now()
    const a = connect('ChunkProbeA'); await once(a, 'position')
    assert.equal(a.chunks.size, 25)
    const b = connect('ChunkProbeB'); await once(b, 'position')
    assert.equal(b.chunks.size, 25)
    console.log('Two clients joined:', (Date.now()-start)/1000, 'seconds')
    const move = async (subject, observer, x, z) => {
      const moved = once(observer, 'sync_entity_position')
      subject.write('position', { x, y: 60, z, flags: {} })
      assert.equal((await moved)[0].x, x)
      assert.equal(subject.chunks.size, 25)
    }
    await move(a, b, -1, -1)
    const terrain = a.chunks.get('-1,-1'); assert.ok(terrain); assert.ok(a.unloads > 0)
    await move(a, b, 1024, 1024)
    await move(b, a, -1024, -1024)
    await move(a, b, -1, -1)
    assert.equal(a.chunks.get('-1,-1'), terrain, 'Regenerated terrain must be identical')
    console.log('PASS: two clients, 25 chunks each, unload packets, negative/far movement, identical regeneration')
  } finally {
    clearTimeout(timeout)
    for (const c of clients) c.end('Streaming test complete')
  }
}
if (require.main === module) main().catch(err => { console.error(err); process.exitCode = 1 })
module.exports = { main }

const test = require('node:test')
const assert = require('node:assert/strict')
const { once } = require('node:events')
const mc = require('minecraft-protocol')
const { createGame } = require('../host/minecraft')
const { fakeMCU } = require('./helpers/fake-mcu')

test('two-chunk view follows negative and distant movement, unloads old chunks and tolerates movement bursts', { timeout: 15000 }, async () => {
  const fake = fakeMCU()
  const server = createGame(fake.rpc, null, { port: 0 })
  const clients = []
  try {
    await once(server, 'listening')
    const connect = name => {
      const c = mc.createClient({ host: '127.0.0.1', port: server.socketServer.address().port,
        username: name, auth: 'offline', version: '26.1' })
      clients.push(c); return c
    }
    const a = connect('Walker'); const loaded = new Set(); let unloaded = 0
    a.on('map_chunk', p => loaded.add(`${p.x},${p.z}`))
    a.on('unload_chunk', p => { unloaded++; loaded.delete(`${p.chunkX},${p.chunkZ}`) })
    await once(a, 'position'); assert.equal(loaded.size, 25)
    const b = connect('Observer'); await once(b, 'position')
    let changed = once(b, 'sync_entity_position')
    a.write('position', { x: -1, y: 60, z: 16, flags: {} })
    assert.equal((await changed)[0].x, -1)
    assert.equal(unloaded, 10); assert.equal(loaded.size, 25)
    assert.ok(loaded.has('-3,-1')); assert.ok(!loaded.has('3,1'))
    assert.deepEqual(fake.views.get(0), [-1, 1])
    assert.deepEqual(fake.views.get(1), [1, 1])
    changed = new Promise(resolve => b.on('sync_entity_position', p => { if (p.x === 1083) resolve(p) }))
    for (let i = 0; i < 60; i++) a.write('position', { x: 1024+i, y: 60, z: -1000, flags: {} })
    await changed
    assert.equal(loaded.size, 25)
    assert.deepEqual(fake.views.get(0), [67, -63])
    assert.deepEqual(fake.views.get(1), [1, 1])
  } finally {
    for (const c of clients) c.end('Test complete')
    for (const c of Object.values(server.clients)) c.end('Test complete')
    server.close()
  }
})

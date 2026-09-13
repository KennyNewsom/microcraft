const test = require('node:test')
const assert = require('node:assert/strict')
const { once } = require('node:events')
const mc = require('minecraft-protocol')
const { createGame } = require('../host/minecraft')

test('four clients see players and shared edits; fifth refused and freed slot reused', { timeout: 15000 }, async () => {
  const { fakeMCU } = require('./helpers/fake-mcu')
  const fake = fakeMCU()
  const players = fake.players; const actors = fake.calls
  const server = createGame(fake.rpc, null, { port: 0 })
  const clients = []
  try {
    await once(server, 'listening')
    const connect = name => {
      const c = mc.createClient({ host: '127.0.0.1', port: server.socketServer.address().port,
        username: name, auth: 'offline', version: '26.1' })
      c.skinMetadata = []
      c.on('entity_metadata', packet => c.skinMetadata.push(packet))
      clients.push(c); return c
    }
    const a = connect('PlayerOne'); await once(a, 'position')
    const seesB = once(a, 'spawn_entity')
    const b = connect('PlayerTwo'); const seesA = once(b, 'spawn_entity')
    const [posB] = await once(b, 'position'); assert.equal(posB.x, 18)
    assert.equal((await seesA)[0].entityId, 100)
    assert.equal((await seesB)[0].entityId, 101)
    b.on('entity_teleport', () => assert.fail('Legacy teleport packet must never be sent'))
    const moved = once(b, 'sync_entity_position')
    a.write('position', { x: 4, y: 10, z: 4, flags: {} })
    assert.equal((await moved)[0].x, 4)
    assert.deepEqual(players[0], [128, 320, 128])
    assert.deepEqual(players[1], [576, 320, 512])
    for (const viewer of [a, b]) for (const entityId of [100, 101]) {
      assert.ok(viewer.skinMetadata.some(p => p.entityId === entityId &&
        p.metadata.some(m => m.key === 16 && m.type === 'byte' && m.value === 127)), 'Initial skin overlays reach self and peers')
    }
    const layerA = once(a, 'entity_metadata'); const layerB = once(b, 'entity_metadata')
    a.write('settings', { locale: 'en_us', viewDistance: 2, chatFlags: 0, chatColors: true,
      skinParts: 0, mainHand: 1, enableTextFiltering: false, enableServerListing: true })
    for (const packet of [(await layerA)[0], (await layerB)[0]]) {
      assert.equal(packet.entityId, 100)
      assert.deepEqual(packet.metadata, [{ key: 16, type: 'byte', value: 0 }])
    }
    const blockA = once(a, 'block_change'); const blockB = once(b, 'block_change')
    b.write('block_dig', { status: 0, location: { x: 18, y: 7, z: 16 }, face: 1, sequence: 1 })
    assert.deepEqual((await blockA)[0], (await blockB)[0])
    assert.ok(actors.some(([op, actor]) => op === 5 && actor === 1))
    const third = connect('PlayerThree')
    assert.equal((await once(third, 'position'))[0].x, 20)
    const fourth = connect('PlayerFour')
    assert.equal((await once(fourth, 'position'))[0].x, 22)
    const shared = [a, b, third, fourth].map(c => once(c, 'block_change'))
    fourth.write('block_dig', { status: 0, location: { x: 22, y: 7, z: 16 }, face: 1, sequence: 2 })
    for (const result of await Promise.all(shared)) assert.equal(result[0].type, 0)
    assert.ok(actors.some(([op, actor]) => op === 5 && actor === 3))
    const fifth = connect('PlayerFive')
    const [kick] = await once(fifth, 'kick_disconnect')
    assert.ok(JSON.stringify(kick).includes('four player slots'))
    fifth.end('Done')
    const removed = once(a, 'entity_destroy')
    b.end('Leaving'); assert.deepEqual((await removed)[0].entityIds, [101])
    // The MCU leave operation completes after queued work, before slot reuse.
    await new Promise(resolve => setTimeout(resolve, 100))
    const replacement = connect('Replacement')
    assert.equal((await once(replacement, 'position'))[0].x, 18)
    assert.ok(actors.some(([op, actor]) => op === 10 && actor === 1))
  } finally {
    for (const c of clients) c.end('Test complete')
    for (const c of Object.values(server.clients)) c.end('Test complete')
    server.close()
  }
})

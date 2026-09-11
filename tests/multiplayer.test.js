const test = require('node:test')
const assert = require('node:assert/strict')
const { once } = require('node:events')
const mc = require('minecraft-protocol')
const { createGame } = require('../host/minecraft')

test('two clients see players, movement and shared edits; third refused and freed slot reused', { timeout: 15000 }, async () => {
  const players = [null, null]
  const actors = []
  const rpc = async (op, p) => {
    const actor = p[47]; actors.push([op, actor])
    const b = Buffer.alloc(48)
    if (op === 9) { players[actor] = [512 + actor * 64, 320, 512]; b[6] = 1 }
    if (op === 8) { players[actor] = [p.readInt16LE(0), p.readInt16LE(2), p.readInt16LE(4)]; b[6] = 1 }
    if (op === 5) { p.copy(b); b[4] = 1 }
    else if (players[actor]) players[actor].forEach((v, i) => b.writeInt16LE(v, i * 2))
    if (op === 10) players[actor] = null
    return b
  }
  const server = createGame(rpc, Buffer.alloc(32768), { port: 0 })
  const clients = []
  try {
    await once(server, 'listening')
    const connect = name => {
      const c = mc.createClient({ host: '127.0.0.1', port: server.socketServer.address().port,
        username: name, auth: 'offline', version: '26.1' })
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
    const blockA = once(a, 'block_change'); const blockB = once(b, 'block_change')
    b.write('block_dig', { status: 0, location: { x: 18, y: 7, z: 16 }, face: 1, sequence: 1 })
    assert.deepEqual((await blockA)[0], (await blockB)[0])
    assert.ok(actors.some(([op, actor]) => op === 5 && actor === 1))
    const third = connect('PlayerThree')
    const [kick] = await once(third, 'kick_disconnect')
    assert.ok(JSON.stringify(kick).includes('two player slots'))
    third.end('Done')
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

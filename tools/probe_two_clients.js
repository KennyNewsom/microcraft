'use strict'
const mc = require('minecraft-protocol')
const assert = require('node:assert/strict')
const { once } = require('node:events')
const fs = require('node:fs')
const path = require('node:path')
const data = require('minecraft-data')('26.1')
const palette = require('../host/data/palette.json')

async function main () {
  const clients = []
  const timeout = setTimeout(() => { console.error('Two-client probe timeout'); process.exit(1) }, 20000)
  const connect = name => {
    const c = mc.createClient({ host: process.env.MICROCRAFT_TEST_HOST || '127.0.0.1', port: 25565,
      username: name, auth: 'offline', version: '26.1' })
    c.on('error', err => console.error(err.message)); clients.push(c); return c
  }
  const move = (c, x, z) => c.write('position', { x, y: 10, z, flags: {} })
  try {
    const a = connect('MicrocraftTestA'); const [pa] = await once(a, 'position')
    a.write('teleport_confirm', { teleportId: pa.teleportId })
    const aSeesB = once(a, 'spawn_entity')
    const b = connect('MicrocraftTestB'); const bSeesA = once(b, 'spawn_entity')
    const [pb] = await once(b, 'position'); b.write('teleport_confirm', { teleportId: pb.teleportId })
    assert.equal((await aSeesB)[0].entityId, 101); assert.equal((await bSeesA)[0].entityId, 100)
    const start = performance.now()
    for (let n = 0; n < 100; n++) {
      const seenA = once(b, 'sync_entity_position'); const seenB = once(a, 'sync_entity_position')
      move(a, 4 + (n % 2), 4); move(b, 25 + (n % 2), 25)
      assert.equal((await seenA)[0].x, 4 + (n % 2))
      assert.equal((await seenB)[0].x, 25 + (n % 2))
    }
    const runtime = performance.now() - start
    const rejected = once(a, 'position')
    move(a, -10, 4)
    assert.equal((await rejected)[0].x, 5, 'A correction must use A state, not B state')
    const location = { x: 4, y: 7, z: 4 }
    const filename = path.join(__dirname, '../world/blocks.bin')
    const before = fs.readFileSync(filename)
    const offset = (7 * 32 + 4) * 32 + 4
    const original = before[offset]
    const rejectedEdit = once(b, 'block_change')
    b.write('block_dig', { status: 0, location, face: 1, sequence: 1 })
    assert.equal((await rejectedEdit)[0].type, data.blocksByName[palette[original]].defaultState,
      'Distant player B must not borrow player A reach')
    assert.deepEqual(fs.readFileSync(filename), before)
    try {
      const updateA = once(a, 'block_change'); const updateB = once(b, 'block_change')
      a.write('block_dig', { status: 0, location, face: 1, sequence: 1 })
      assert.equal((await updateA)[0].type, 0); assert.equal((await updateB)[0].type, 0)
      assert.equal(fs.readFileSync(filename)[offset], 0)
    } finally {
      const updateA = once(a, 'block_change'); const updateB = once(b, 'block_change')
      if (original === 0) a.write('block_dig', { status: 0, location, face: 1, sequence: 2 })
      else {
        a.write('set_creative_slot', { slot: 36, item: { itemCount: 64, itemId: data.itemsByName[palette[original]].id,
          addedComponentCount: 0, removedComponentCount: 0, components: [], removeComponents: [] } })
        a.write('block_place', { hand: 0, location: { x: 4, y: 6, z: 4 }, direction: 1,
          cursorX: 0.5, cursorY: 1, cursorZ: 0.5, insideBlock: false, worldBorderHit: false, sequence: 2 })
      }
      const expected = data.blocksByName[palette[original]].defaultState
      assert.equal((await updateA)[0].type, expected); assert.equal((await updateB)[0].type, expected)
      assert.deepEqual(fs.readFileSync(filename), before, 'Probe must restore the entire saved world')
    }
    const destroy = once(a, 'entity_destroy'); b.end('Probe leave')
    assert.deepEqual((await destroy)[0].entityIds, [101])
    await new Promise(resolve => setTimeout(resolve, 100))
    const c = connect('MicrocraftTestC'); assert.equal((await once(c, 'position'))[0].x, 18)
    console.log(JSON.stringify({ status: 'PASS', clients: 2, authoritativeMoves: 200, movementTestMs: Math.round(runtime),
      visiblePlayers: true, separateReach: true, sharedEdits: true, slotReuse: true, worldPreserved: true }, null, 2))
  } finally {
    clearTimeout(timeout)
    for (const c of clients) c.end('Probe complete')
  }
}
main().catch(err => { console.error(err); process.exitCode = 1 })

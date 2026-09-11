'use strict'
// A real protocol client: use only against the local prototype during verification.
const mc = require('minecraft-protocol')
const assert = require('node:assert/strict')
const { once } = require('node:events')
const fs = require('node:fs')
const path = require('node:path')
async function main () {
  const client = mc.createClient({ host: '127.0.0.1', port: 25565, username: 'MicrocraftProbe',
    auth: 'offline', version: '26.1' })
  const timeout = setTimeout(() => { console.error('Probe timeout'); process.exit(1) }, 15000)
  let chunks = 0
  client.on('map_chunk', () => chunks++)
  client.on('error', e => { console.error(e); process.exitCode = 1 })
  try {
    const [pos] = await once(client, 'position')
    assert.equal(pos.x, 16)
    assert.equal(chunks, 16)
    client.write('teleport_confirm', { teleportId: pos.teleportId })
    const corrected = once(client, 'position')
    client.write('position', { x: -10, y: 10, z: 16, flags: {} })
    const [correction] = await corrected
    assert.equal(correction.x, 16, 'MCU must reject out-of-bounds movement')
    client.write('teleport_confirm', { teleportId: correction.teleportId })
    const updated = once(client, 'block_change')
    client.write('block_dig', { status: 0, location: { x: 16, y: 0, z: 16 }, face: 1, sequence: 1 })
    const [block] = await updated
    assert.equal(block.type, require('minecraft-data')('26.1').blocksByName.bedrock.defaultState,
      'MCU must preserve the floor')
    if (process.argv.includes('--edits') || process.argv.includes('--palette')) {
      const data = require('minecraft-data')('26.1')
      const filename = path.join(__dirname, '../world/blocks.bin')
      const offset = (7 * 32 + 16) * 32 + 16
      const original = fs.readFileSync(filename)[offset]
      const name = require('../host/data/palette.json')[original]
      assert.ok(name, 'Persistence probe needs a recognized saved block at 16,7,16')
      let sequence = 3
      async function place (blockName) {
        client.write('set_creative_slot', { slot: 36, item: { itemCount: 64,
          itemId: data.itemsByName[blockName].id, addedComponentCount: 0, removedComponentCount: 0,
          components: [], removeComponents: [] } })
        const changed = once(client, 'block_change')
        client.write('block_place', { hand: 0, location: { x: 16, y: 6, z: 16 }, direction: 1,
          cursorX: 0.5, cursorY: 1, cursorZ: 0.5, insideBlock: false, worldBorderHit: false, sequence: sequence++ })
        assert.equal((await changed)[0].type, data.blocksByName[blockName].defaultState)
      }
      try {
        const removed = once(client, 'block_change')
        client.write('block_dig', { status: 0, location: { x: 16, y: 7, z: 16 }, face: 1, sequence: 2 })
        assert.equal((await removed)[0].type, 0)
        assert.equal(fs.readFileSync(filename)[offset], 0, 'Accepted edit must be durable on the PC')
        if (process.argv.includes('--palette')) {
          const names = require('../host/data/palette.json')
          for (const blockName of ['oak_planks', 'glass', 'red_wool', 'cyan_concrete', 'diamond_block', names[254]]) {
            await place(blockName)
            assert.equal(fs.readFileSync(filename)[offset], names.indexOf(blockName), 'New block must persist without ID truncation')
          }
        }
      } finally {
        if (original === 0) {
          const restored = once(client, 'block_change')
          client.write('block_dig', { status: 0, location: { x: 16, y: 7, z: 16 }, face: 1, sequence: sequence++ })
          assert.equal((await restored)[0].type, 0)
        } else await place(name)
        assert.equal(fs.readFileSync(filename)[offset], original, 'Probe must restore the original block')
      }
    }
    console.log('PASS: real micro:bit startup, 16 chunks, movement rejection, immutable floor' +
      (process.argv.includes('--edits') || process.argv.includes('--palette') ? ', accepted edits persisted on PC and restored' : ''))
  } finally {
    clearTimeout(timeout)
    client.end('Probe complete')
  }
}
main().catch(e => { console.error(e); process.exitCode = 1 })

const test = require('node:test')
const assert = require('node:assert/strict')
const { once } = require('node:events')
const mc = require('minecraft-protocol')
const { createGame, chunkPacket } = require('../host/minecraft')

test('26.1 client completes configuration, receives chunks and MCU-authorized edits', { timeout: 15000 }, async () => {
  const world = Buffer.alloc(32768)
  const calls = []
  const server = createGame(async (op, payload) => {
    calls.push(op)
    const response = Buffer.alloc(48)
    if (op === 9) { response.writeInt16LE(512, 0); response.writeInt16LE(320, 2); response.writeInt16LE(512, 4); response[6] = 1 }
    if (op === 5) { payload.copy(response); response[4] = payload[3] < 255 ? 1 : 0 }
    return response
  }, world, { port: 0 })
  let client
  try {
    await once(server, 'listening')
    client = mc.createClient({ host: '127.0.0.1', port: server.socketServer.address().port,
      username: 'ProtocolTest', auth: 'offline', version: '26.1' })
    let chunks = 0
    let tagsReceived = false
    client.on('tags', packet => {
      const registry = name => packet.tags.find(r => r.tagType === name).tags
      const armor = registry('minecraft:item').find(t => t.tagName === 'minecraft:enchantable/armor')
      assert.ok(armor.entries.includes(require('minecraft-data')('26.1').itemsByName.diamond_chestplate.id))
      assert.ok(registry('minecraft:dialog').some(t => t.tagName === 'minecraft:quick_actions'))
      assert.ok(registry('minecraft:timeline').some(t => t.tagName === 'minecraft:in_overworld'))
      tagsReceived = true
    })
    client.on('finish_configuration', () => assert.ok(tagsReceived, 'Required tags must arrive before configuration finishes'))
    client.on('map_chunk', p => { assert.ok(p.chunkData.length > 0); chunks++ })
    const errors = []
    client.on('error', e => errors.push(e))
    const [position] = await once(client, 'position')
    assert.equal(position.x, 16)
    assert.equal(chunks, 16)
    assert.ok(tagsReceived)
    client.write('teleport_confirm', { teleportId: position.teleportId })
    const changed = once(client, 'block_change')
    client.write('block_dig', { status: 0, location: { x: 16, y: 7, z: 16 }, face: 1, sequence: 1 })
    const [block] = await changed
    assert.equal(block.type, 0)
    assert.deepEqual(calls, [9, 5])
    const data = require('minecraft-data')('26.1')
    const { paletteNames } = require('../host/minecraft')
    for (const name of ['oak_planks', 'glass', 'red_wool', 'cyan_concrete', 'diamond_block', 'nether_quartz_ore']) {
      client.write('set_creative_slot', { slot: 36, item: { itemCount: 64,
        itemId: data.itemsByName[name].id, addedComponentCount: 0, removedComponentCount: 0,
        components: [], removeComponents: [] } })
      const placed = once(client, 'block_change')
      client.write('block_place', { hand: 0, location: { x: 16, y: 6, z: 16 }, direction: 1,
        cursorX: 0.5, cursorY: 1, cursorZ: 0.5, insideBlock: false, worldBorderHit: false, sequence: 2 })
      assert.equal((await placed)[0].type, data.blocksByName[name].defaultState)
      assert.equal(world[(7 * 32 + 16) * 32 + 16], paletteNames.indexOf(name))
    }
    client.write('set_creative_slot', { slot: 36, item: { itemCount: 64,
      itemId: data.itemsByName.diamond_sword.id, addedComponentCount: 0, removedComponentCount: 0,
      components: [], removeComponents: [] } })
    const denied = once(client, 'block_change')
    client.write('block_place', { hand: 0, location: { x: 16, y: 6, z: 16 }, direction: 1,
      cursorX: 0.5, cursorY: 1, cursorZ: 0.5, insideBlock: false, worldBorderHit: false, sequence: 3 })
    assert.equal((await denied)[0].type, data.blocksByName.nether_quartz_ore.defaultState,
      'Unsupported items must not silently turn into stone')
    assert.equal(errors.length, 0)
  } finally {
    if (client) client.end('Test complete')
    for (const c of Object.values(server.clients)) c.end('Test complete')
    server.close()
  }
})

test('expanded palette preserves old saves and stays within one byte per block', () => {
  const { paletteNames, palette, itemPalette } = require('../host/minecraft')
  assert.deepEqual(paletteNames.slice(0, 5), ['air', 'bedrock', 'dirt', 'grass_block', 'stone'])
  assert.equal(paletteNames.length, 255)
  assert.equal(new Set(paletteNames).size, 255)
  for (const id of palette) assert.ok(Number.isInteger(id))
  assert.equal(itemPalette.has(require('minecraft-data')('26.1').itemsByName.diamond_sword.id), false)
  const header = require('node:fs').readFileSync(require('node:path').join(__dirname, '../firmware/Palette.h'), 'utf8')
  assert.ok(header.includes(`BLOCK_PALETTE_SIZE = ${paletteNames.length};`))
})

test('chunk encoding preserves a micro:bit block in the PC network representation', () => {
  const world = Buffer.alloc(32768)
  world[(7 * 32 + 2) * 32 + 3] = 4
  const packet = chunkPacket(world, 0, 0)
  const Chunk = require('prismarine-chunk')('26.1')
  const chunk = new Chunk()
  chunk.load(packet.chunkData)
  assert.equal(chunk.getBlockStateId({ x: 3, y: 7, z: 2 }), require('minecraft-data')('26.1').blocksByName.stone.defaultState)
})

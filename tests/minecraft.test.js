const test = require('node:test')
const assert = require('node:assert/strict')
const { once } = require('node:events')
const mc = require('minecraft-protocol')
const { createGame, chunkPacket } = require('../host/minecraft')

test('26.1 client completes configuration, receives chunks and MCU-authorized edits', { timeout: 15000 }, async () => {
  const { fakeMCU } = require('./helpers/fake-mcu')
  const fake = fakeMCU()
  const server = createGame(fake.rpc, null, { port: 0 })
  let client
  try {
    await once(server, 'listening')
    client = mc.createClient({ host: '127.0.0.1', port: server.socketServer.address().port,
      username: 'ProtocolTest', auth: 'offline', version: '26.1' })
    let chunks = 0
    let tagsReceived = false
    let fogReceived = false
    client.on('registry_data', packet => {
      if (packet.id !== 'minecraft:dimension_type') return
      const entry = packet.entries.find(e => e.key === 'minecraft:overworld')
      const attributes = entry.value.value.attributes.value
      assert.equal(attributes['minecraft:visual/fog_start_distance'].value, 6)
      assert.equal(attributes['minecraft:visual/fog_end_distance'].value, 14)
      const vanilla = require('minecraft-data')('26.1').loginPacket.dimensionCodec
      assert.equal(vanilla['minecraft:dimension_type'].entries[0].value.value.attributes.value['minecraft:visual/fog_end_distance'], undefined,
        'Server fog must not mutate the shared vanilla registry')
      fogReceived = true
    })
    client.on('tags', packet => {
      const registry = name => packet.tags.find(r => r.tagType === name).tags
      const armor = registry('minecraft:item').find(t => t.tagName === 'minecraft:enchantable/armor')
      assert.ok(armor.entries.includes(require('minecraft-data')('26.1').itemsByName.diamond_chestplate.id))
      assert.ok(registry('minecraft:dialog').some(t => t.tagName === 'minecraft:quick_actions'))
      assert.ok(registry('minecraft:timeline').some(t => t.tagName === 'minecraft:in_overworld'))
      tagsReceived = true
    })
    client.on('finish_configuration', () => {
      assert.ok(tagsReceived, 'Required tags must arrive before configuration finishes')
      assert.ok(fogReceived, 'Fog distance must be sent before the world loads')
    })
    client.on('map_chunk', p => { assert.ok(p.chunkData.length > 0); chunks++ })
    const errors = []
    client.on('error', e => errors.push(e))
    const [position] = await once(client, 'position')
    assert.equal(client.compressionThreshold, 256, 'Vanilla-compatible zlib is negotiated for client traffic')
    assert.equal(position.x, 16)
    assert.equal(chunks, 25)
    assert.ok(tagsReceived)
    client.write('teleport_confirm', { teleportId: position.teleportId })
    const changed = once(client, 'block_change')
    client.write('block_dig', { status: 0, location: { x: 16, y: 7, z: 16 }, face: 1, sequence: 1 })
    const [block] = await changed
    assert.equal(block.type, 0)
    assert.ok(fake.calls.some(([op]) => op === 5))
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
      assert.equal(fake.chunks.get('1,1')[7], paletteNames.indexOf(name))
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

test('state palette preserves all legacy IDs and maps functional items', () => {
  const { paletteNames, palette, itemPalette } = require('../host/minecraft')
  assert.deepEqual(paletteNames.slice(0, 5), ['air', 'bedrock', 'dirt', 'grass_block', 'stone'])
  assert.equal(paletteNames.length, 255)
  assert.equal(new Set(paletteNames).size, 255)
  for (const id of palette) assert.ok(Number.isInteger(id))
  assert.equal(itemPalette.has(require('minecraft-data')('26.1').itemsByName.diamond_sword.id), false)
  const header = require('node:fs').readFileSync(require('node:path').join(__dirname, '../firmware/Palette.h'), 'utf8')
  assert.ok(header.includes(`BLOCK_PALETTE_SIZE = ${paletteNames.length};`))
  const data = require('minecraft-data')('26.1')
  for (const name of ['oak_door', 'iron_trapdoor', 'stone_stairs', 'oak_slab', 'lever', 'redstone', 'redstone_lamp'])
    assert.ok(itemPalette.get(data.itemsByName[name].id) >= 255)
  const Block = require('prismarine-block')('26.1')
  for (const entry of require('../host/data/states.json').states.slice(255)) {
    const block = Block.fromStateId(entry.state, 0)
    assert.equal(block.name, entry.name)
    const normalize = p => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, String(v)]))
    assert.deepEqual(normalize(block.getProperties()), normalize(entry.properties))
  }
})

test('chunk encoding preserves 16-bit rotated and powered states', () => {
  const { states, groups } = require('../host/data/states.json')
  const world = Buffer.alloc(65536)
  const ids = [groups.find(g => g.name === 'oak_door').start + 44,
    groups.find(g => g.name === 'stone_stairs').start + 23,
    groups.find(g => g.name === 'redstone_wire').start + 1295]
  ids.forEach((id, x) => world.writeUInt16LE(id, ((2*16+x)*128+8)*2))
  const chunk = new (require('prismarine-chunk')('26.1'))()
  chunk.load(chunkPacket(world, 0, 0).chunkData)
  ids.forEach((id, x) => assert.equal(chunk.getBlockStateId({x, y:8, z:2}), states[id].state))
})

test('chunk encoding preserves a micro:bit block in the PC network representation', () => {
  const world = Buffer.alloc(32768)
  world[(2 * 16 + 3) * 128 + 7] = 4
  const packet = chunkPacket(world, 0, 0)
  const Chunk = require('prismarine-chunk')('26.1')
  const chunk = new Chunk()
  chunk.load(packet.chunkData)
  assert.equal(chunk.getBlockStateId({ x: 3, y: 7, z: 2 }), require('minecraft-data')('26.1').blocksByName.stone.defaultState)
})

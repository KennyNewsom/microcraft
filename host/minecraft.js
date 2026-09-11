'use strict'
const mc = require('minecraft-protocol')
const data = require('minecraft-data')('26.1')
const Chunk = require('prismarine-chunk')('26.1')
const { Vec3 } = require('vec3')
const registryTags = require('./data/tags-26.1.json')
const paletteNames = require('./data/palette.json')
const palette = paletteNames.map(n => data.blocksByName[n].defaultState)
const itemPalette = new Map(paletteNames.map((name, id) => [data.itemsByName[name]?.id, id])
  .filter(([item, id]) => item !== undefined && id !== 0))
const index = (x, y, z) => (y * 32 + z) * 32 + x
const inside = p => Number.isInteger(p.x) && Number.isInteger(p.y) && Number.isInteger(p.z) &&
  p.x >= 0 && p.x < 32 && p.y >= 0 && p.y < 32 && p.z >= 0 && p.z < 32

function chunkPacket (world, cx, cz) {
  const chunk = new Chunk()
  for (let y = 0; y < 32; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
    const p = new Vec3(x, y, z)
    const wx = cx * 16 + x; const wz = cz * 16 + z
    chunk.setBlockStateId(p, inside({ x: wx, y, z: wz }) ? palette[world[index(wx, y, wz)]] : 0)
  }
  // Static full skylight; lighting simulation is outside this creative prototype.
  for (let s = -5; s <= 20; s++) chunk.setSkyLight(new Vec3(0, s * 16, 0), 15)
  const light = chunk.dumpLight()
  light.skyLight = light.skyLight.map(() => Array(2048).fill(255))
  return { x: cx, z: cz, heightmaps: [], chunkData: chunk.dump(), blockEntities: [], ...light }
}

function positionPacket (entityId, position, yaw, pitch) {
  // Java 26.1 EntityPositionSync: id, position Vec3, velocity Vec3, two floats, bool.
  // The dependency's legacy entity_teleport schema is incompatible with vanilla.
  return { entityId, x: position.readInt16LE(0) / 32, y: position.readInt16LE(2) / 32,
    z: position.readInt16LE(4) / 32, dx: 0, dy: 0, dz: 0, yaw, pitch, onGround: false }
}

function createGame (rpc, world, options = {}) {
  const server = mc.createServer({ version: '26.1', host: '127.0.0.1', port: 25565,
    'online-mode': false, 'max-players': 2, motd: 'Microcraft | game logic on micro:bit v2',
    ...options })
  const sessions = [null, null]
  const actorPayload = (slot, payload = Buffer.alloc(0)) => {
    const b = Buffer.alloc(48); payload.copy(b); b[47] = slot; return b
  }
  const angle = value => { const b = Math.floor(value * 256 / 360) & 255; return b > 127 ? b - 256 : b }
  const info = s => ({ action: { add_player: true, update_game_mode: true, update_listed: true, update_latency: true },
    data: [{ uuid: s.client.uuid, player: { name: s.client.username, properties: [] }, gamemode: 1, listed: 1, latency: 0 }] })
  const coordinates = s => ({ x: s.position.readInt16LE(0) / 32, y: s.position.readInt16LE(2) / 32,
    z: s.position.readInt16LE(4) / 32 })
  const showPlayer = (viewer, subject) => {
    viewer.client.write('player_info', info(subject))
    viewer.client.write('spawn_entity', { entityId: subject.entityId, objectUUID: subject.client.uuid,
      type: data.entitiesByName.player.id, ...coordinates(subject), velocity: { x: 0, y: 0, z: 0 },
      pitch: angle(subject.pitch), yaw: angle(subject.yaw), headPitch: angle(subject.yaw), objectData: 0 })
  }
  const broadcastPose = subject => {
    for (const viewer of sessions) if (viewer?.ready && viewer !== subject) {
      viewer.client.write('sync_entity_position', positionPacket(subject.entityId, subject.position, subject.yaw, subject.pitch))
      viewer.client.write('entity_head_rotation', { entityId: subject.entityId, headYaw: angle(subject.yaw) })
    }
  }
  server.on('connection', client => {
    // The state event fires after the configuration serializer is installed and
    // before minecraft-protocol sends registries and finish_configuration.
    client.on('state', state => {
      if (state === mc.states.CONFIGURATION) client.write('tags', registryTags)
    })
  })
  server.on('playerJoin', client => {
    if (sessions.some(s => s?.client.uuid === client.uuid)) { client.end('That username is already connected.'); return }
    const slot = sessions.indexOf(null)
    if (slot < 0) { client.end('Microcraft has two player slots.'); return }
    const session = { client, slot, entityId: 100 + slot, position: Buffer.alloc(6), yaw: 0, pitch: 0, ready: false }
    sessions[slot] = session
    const playerRpc = (op, payload) => rpc(op, actorPayload(slot, payload))
    let ended = false; let teleportId = 0; let selected = 0
    const inventory = Array(10).fill(255) // Hotbar plus offhand; 255 cannot be placed.
    let chain = Promise.resolve(); let queued = 0
    const work = action => {
      if (ended) return
      if (++queued > 32) { client.end('Input queue full'); queued--; return }
      chain = chain.then(async () => { if (!ended) await action() }).catch(err => {
        client.end('Microcraft stopped: ' + err.message)
        server.emit('bridgeError', err)
      }).finally(() => { queued-- })
    }
    const teleport = pos => client.write('position', { teleportId: ++teleportId,
      x: pos.readInt16LE(0) / 32, y: pos.readInt16LE(2) / 32, z: pos.readInt16LE(4) / 32,
      dx: 0, dy: 0, dz: 0, yaw: 0, pitch: 0, flags: {} })
    client.on('end', () => {
      ended = true; session.ready = false
      for (const viewer of sessions) if (viewer?.ready) {
        viewer.client.write('entity_destroy', { entityIds: [session.entityId] })
        viewer.client.write('player_remove', { players: [client.uuid] })
      }
      // Keep the slot reserved until all old actions and the MCU leave have completed.
      chain.then(() => playerRpc(10)).catch(err => server.emit('bridgeError', err)).finally(() => {
        if (sessions[slot] === session) sessions[slot] = null
      })
    })
    client.on('error', err => console.error('Client:', err.message))
    work(async () => {
      const spawn = await playerRpc(9)
      if (!spawn[6]) throw new Error('MCU player slot is occupied')
      if (ended) return
      session.position = Buffer.from(spawn.subarray(0, 6))
      const login = data.loginPacket
      client.write('login', { ...login, entityId: session.entityId, maxPlayers: 2, viewDistance: 2,
        simulationDistance: 2, worldState: { ...login.worldState, gamemode: 'creative' } })
      client.write('abilities', { flags: 15, flyingSpeed: 0.05, walkingSpeed: 0.1 })
      client.write('spawn_position', { globalPos: { dimensionName: 'minecraft:overworld',
        location: { x: 16, y: 10, z: 16 } }, yaw: 0, pitch: 0 })
      client.write('update_view_position', { chunkX: 1, chunkZ: 1 })
      client.write('initialize_world_border', { x: 16, z: 16, oldDiameter: 32, newDiameter: 32,
        speed: 0, portalTeleportBoundary: 29999984, warningBlocks: 1, warningTime: 0 })
      client.write('game_state_change', { reason: 'level_chunks_load_start', gameMode: 0 })
      client.write('chunk_batch_start', {})
      // Border chunks keep the client's immediate view loaded; only four contain MCU blocks.
      for (let z = -1; z <= 2; z++) for (let x = -1; x <= 2; x++) client.write('map_chunk', chunkPacket(world, x, z))
      client.write('chunk_batch_finished', { batchSize: 16 })
      teleport(spawn)
      session.ready = true
      client.write('player_info', info(session))
      for (const other of sessions) if (other?.ready && other !== session) {
        showPlayer(session, other); showPlayer(other, session)
      }
    })
    const move = p => work(async () => {
      const b = Buffer.alloc(6)
      for (const [i, axis] of ['x', 'y', 'z'].entries()) {
        // Saturation is wire encoding only; the MCU decides whether to accept movement.
        const v = Number.isFinite(p[axis]) ? Math.max(-32768, Math.min(32767, Math.round(p[axis] * 32))) : -32768
        b.writeInt16LE(v, i * 2)
      }
      const result = await playerRpc(8, b)
      if (ended) return
      session.position = Buffer.from(result.subarray(0, 6))
      if (Number.isFinite(p.yaw)) session.yaw = p.yaw % 360
      if (Number.isFinite(p.pitch)) session.pitch = Math.max(-90, Math.min(90, p.pitch))
      if (!result[6]) teleport(result)
      broadcastPose(session)
    })
    client.on('position', move)
    client.on('position_look', move)
    client.on('look', p => {
      if (!session.ready || !Number.isFinite(p.yaw) || !Number.isFinite(p.pitch)) return
      session.yaw = p.yaw % 360; session.pitch = Math.max(-90, Math.min(90, p.pitch))
      broadcastPose(session)
    })
    client.on('held_item_slot', p => { if (p.slotId >= 0 && p.slotId < 9) selected = p.slotId })
    client.on('set_creative_slot', p => {
      const slot = p.slot - 36
      if (slot < 0 || slot > 9) return
      inventory[slot] = p.item?.itemCount > 0 ? (itemPalette.get(p.item.itemId) ?? 255) : 255
    })
    const edit = (p, block, sequence) => work(async () => {
      // Coordinates too large for the compact wire representation are sent as invalid 255.
      const coordinates = ['x', 'y', 'z'].map(k => Number.isInteger(p[k]) && p[k] >= 0 && p[k] < 32 ? p[k] : 255)
      const result = await playerRpc(5, Buffer.from([...coordinates, block]))
      if (result[4] && inside(p)) world[index(p.x, p.y, p.z)] = block
      const update = { location: p, type: inside(p) ? palette[world[index(p.x, p.y, p.z)]] : 0 }
      if (result[4]) {
        for (const viewer of sessions) if (viewer?.ready) viewer.client.write('block_change', update)
      } else if (!ended) client.write('block_change', update)
      if (!ended) client.write('acknowledge_player_digging', { sequenceId: sequence })
    })
    client.on('block_dig', p => {
      if (p.status === 0 || p.status === 2) edit(p.location, 0, p.sequence)
    })
    client.on('block_place', p => {
      const d = [[0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]][p.direction]
      if (!d) return
      const block = inventory[p.hand === 1 ? 9 : selected]
      if (block === 255) client.write('system_chat', { content: require('prismarine-nbt').comp({ text:
        require('prismarine-nbt').string('That item is not supported as a building block yet.') }), isActionBar: true })
      edit({ x: p.location.x + d[0], y: p.location.y + d[1], z: p.location.z + d[2] }, block, p.sequence)
    })
  })
  return server
}

module.exports = { createGame, chunkPacket, palette, paletteNames, itemPalette, index, positionPacket }

'use strict'
const mc = require('minecraft-protocol')
const { installChat } = require('./chat')
const { iconProvider } = require('./server-icon')
const data = require('minecraft-data')('26.1')
const Chunk = require('prismarine-chunk')('26.1')
const { Vec3 } = require('vec3')
const registryTags = require('./data/tags-26.1.json')
const paletteNames = require('./data/palette.json')
const statePalette = require('./data/states.json')
const palette = statePalette.states.map(s => s.state)
const itemPalette = new Map(paletteNames.map((name, id) => [data.itemsByName[name]?.id, id])
  .filter(([item, id]) => item !== undefined && id !== 0))
for (const group of statePalette.groups) if (group.item !== undefined) itemPalette.set(group.item, group.start)
const blockId = (bytes, i) => bytes.length === 65536 ? bytes.readUInt16LE(i * 2) : bytes[i]
const setBlockId = (bytes, i, value) => { if (bytes.length === 65536) bytes.writeUInt16LE(value, i * 2); else bytes[i] = value }
const HEIGHT = 128
const FOG_START = 6
const FOG_END = 14
function viewRegistry () {
  const codec = structuredClone(data.loginPacket.dimensionCodec)
  const overworld = codec['minecraft:dimension_type'].entries.find(entry => entry.key === 'minecraft:overworld')
  const attributes = overworld.value.value.attributes.value
  // Vanilla requires all eight neighboring chunks to mesh a section. The outer
  // ring of our 5x5 view supplies those neighbors; the dependable rendered edge
  // can be only 16 blocks away. Fog must be opaque before that inner edge.
  // Registry IDs remain unchanged, and no additional MCU chunks are loaded.
  attributes['minecraft:visual/fog_start_distance'] = { type: 'float', value: FOG_START }
  attributes['minecraft:visual/fog_end_distance'] = { type: 'float', value: FOG_END }
  return codec
}
const index = (x, y, z) => (z * 16 + x) * HEIGHT + y
const inside = p => Number.isInteger(p.x) && Number.isInteger(p.y) && Number.isInteger(p.z) &&
  p.x >= -1000000 && p.x < 1000000 && p.y >= 0 && p.y < HEIGHT && p.z >= -1000000 && p.z < 1000000
const chunkKey = (x, z) => `${x},${z}`
function chunkPacket (world, cx, cz) {
  if (world.length !== 32768 && world.length !== 65536) throw new Error('Invalid MCU chunk size')
  const chunk = new Chunk()
  for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) for (let y = 0; y < HEIGHT; y++) {
    chunk.setBlockStateId(new Vec3(x, y, z), palette[blockId(world, index(x, y, z))])
  }
  for (let section = -5; section <= 20; section++) chunk.setSkyLight(new Vec3(0, section * 16, 0), 15)
  const light = chunk.dumpLight()
  light.skyLight = light.skyLight.map(() => Array(2048).fill(255))
  return { x: cx, z: cz, heightmaps: [], chunkData: chunk.dump(), blockEntities: [], ...light }
}

function positionPacket (entityId, position, yaw, pitch) {
  // Java 26.1 EntityPositionSync: id, position Vec3, velocity Vec3, two floats, bool.
  // The dependency's legacy entity_teleport schema is incompatible with vanilla.
  return { entityId, x: position.readInt32LE(0) / 32, y: position.readInt32LE(4) / 32,
    z: position.readInt32LE(8) / 32, dx: 0, dy: 0, dz: 0, yaw, pitch, onGround: false }
}

function createGame (rpc, unused, options = {}) {
  const getIcon = iconProvider()
  const secureChat = options['online-mode'] === true || options.authenticatedProxy === true
  const server = mc.createServer({ version: '26.1', host: '127.0.0.1', port: 25565,
    'online-mode': false, 'max-players': 4, motd: 'Microcraft | game logic on micro:bit v2',
    registryCodec: viewRegistry(),
    favicon: getIcon(),
    beforePing: response => { response.favicon = getIcon(); return response },
    ...options })
  const sessions = Array(4).fill(null)
  installChat(server, sessions, secureChat)
  // Serialize multi-RPC view changes and edits across all clients.
  let serialWork = Promise.resolve()
  const transaction = action => {
    const result = serialWork.then(action)
    serialWork = result.catch(() => {})
    return result
  }
  const actorPayload = (slot, payload = Buffer.alloc(0)) => {
    const b = Buffer.alloc(48); payload.copy(b); b[47] = slot; return b
  }
  async function applyChanged (response) {
    if (response.length < 48) return
    if ((response.length - 48) % 8) throw new Error('Invalid changed-chunk response')
    for (let cursor = 48; cursor < response.length; cursor += 8) {
      const x = response.readInt32LE(cursor); const z = response.readInt32LE(cursor + 4)
      const key = chunkKey(x, z)
      const previous = sessions.find(s => s?.chunks.has(key))?.chunks.get(key).bytes
      if (!previous) continue
      const bytes = await rpc(22, response.subarray(cursor, cursor + 8))
      for (const viewer of sessions) {
        const entry = viewer?.chunks.get(key)
        if (!entry) continue
        entry.bytes = Buffer.from(bytes)
        if (!viewer.ready) continue
        for (let i = 0; i < 32768; i++) if (blockId(previous, i) !== blockId(bytes, i)) {
          viewer.client.write('block_change', { location: { x: x * 16 + Math.floor(i / 128) % 16,
            y: i % 128, z: z * 16 + Math.floor(i / 2048) }, type: palette[blockId(bytes, i)] })
        }
      }
    }
  }
  const angle = value => { const b = Math.floor(value * 256 / 360) & 255; return b > 127 ? b - 256 : b }
  const info = s => ({ action: { add_player: true, initialize_chat: true, update_game_mode: true, update_listed: true, update_latency: true },
    data: [{ uuid: s.client.uuid, player: { name: s.client.username,
      properties: (s.client.profile?.properties || []).map(({ name, value, signature }) => ({ name, value, signature })) },
    chatSession: s.client.microcraftChat?.session, gamemode: 1, listed: 1, latency: 0 }] })
  const coordinates = s => ({ x: s.position.readInt32LE(0) / 32, y: s.position.readInt32LE(4) / 32,
    z: s.position.readInt32LE(8) / 32 })
  const skinLayers = s => ({ entityId: s.entityId, metadata: [{
    key: data.entitiesByName.player.metadataKeys.indexOf('player_mode_customisation'),
    type: 'byte', value: (s.client.settings?.skinParts ?? 127) & 127
  }] })
  const showPlayer = (viewer, subject) => {
    viewer.client.write('player_info', info(subject))
    viewer.client.write('spawn_entity', { entityId: subject.entityId, objectUUID: subject.client.uuid,
      type: data.entitiesByName.player.id, ...coordinates(subject), velocity: { x: 0, y: 0, z: 0 },
      pitch: angle(subject.pitch), yaw: angle(subject.yaw), headPitch: angle(subject.yaw), objectData: 0 })
    viewer.client.write('entity_metadata', skinLayers(subject))
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
    if (slot < 0) { client.end('Microcraft has four player slots.'); return }
    const session = { client, slot, entityId: 100 + slot, position: Buffer.alloc(12), yaw: 0, pitch: 0, ready: false, chunks: new Map(), center: null }
    sessions[slot] = session
    client.on('settings', () => {
      if (session.ready) for (const viewer of sessions) if (viewer?.ready) {
        viewer.client.write('entity_metadata', skinLayers(session))
      }
    })
    const playerRpc = (op, payload) => rpc(op, actorPayload(slot, payload))
    let ended = false; let teleportId = 0; let selected = 0
    const inventory = Array(10).fill(65535) // Hotbar plus offhand; reserved unsupported ID.
    let sneaking = false
    client.on('player_input', p => { sneaking = !!p.inputs.shift })
    let chain = Promise.resolve(); let queued = 0
    const work = action => {
      if (ended) return
      if (++queued > 32) { client.end('Input queue full'); queued--; return }
      chain = chain.then(async () => { if (!ended) await transaction(action) }).catch(err => {
        client.end('Microcraft stopped: ' + err.message)
        server.emit('bridgeError', err)
      }).finally(() => { queued-- })
    }
    const teleport = pos => client.write('position', { teleportId: ++teleportId,
      x: pos.readInt32LE(0) / 32, y: pos.readInt32LE(4) / 32, z: pos.readInt32LE(8) / 32,
      dx: 0, dy: 0, dz: 0, yaw: 0, pitch: 0, flags: {} })
    client.on('end', () => {
      ended = true; session.ready = false
      for (const viewer of sessions) if (viewer?.ready) {
        viewer.client.write('entity_destroy', { entityIds: [session.entityId] })
        viewer.client.write('player_remove', { players: [client.uuid] })
      }
      // Keep the slot reserved until all old actions and the MCU leave have completed.
      chain.then(() => transaction(async () => applyChanged(await playerRpc(10)))).catch(err => server.emit('bridgeError', err)).finally(() => {
        if (sessions[slot] === session) sessions[slot] = null
      })
    })
    client.on('error', err => console.error('Client:', err.message))
    work(async () => {
      const spawn = await playerRpc(9)
      if (!spawn[12]) throw new Error('MCU player slot is occupied')
      if (ended) return
      session.position = Buffer.from(spawn.subarray(0, 12))
      const login = data.loginPacket
      client.write('login', { ...login, entityId: session.entityId, maxPlayers: 4, viewDistance: 2,
        simulationDistance: 2, enforcesSecureChat: secureChat, worldState: { ...login.worldState, gamemode: 'creative' } })
      client.write('abilities', { flags: 15, flyingSpeed: 0.05, walkingSpeed: 0.1 })
      client.write('spawn_position', { globalPos: { dimensionName: 'minecraft:overworld',
        location: { x: 16, y: 10, z: 16 } }, yaw: 0, pitch: 0 })
      client.write('initialize_world_border', { x: 0, z: 0, oldDiameter: 2000000, newDiameter: 2000000,
        speed: 0, portalTeleportBoundary: 1000000, warningBlocks: 1, warningTime: 0 })
      client.write('game_state_change', { reason: 'level_chunks_load_start', gameMode: 0 })
      await syncView()
      if (ended) return
      teleport(spawn)
      session.ready = true
      client.write('player_info', info(session))
      client.write('entity_metadata', skinLayers(session))
      for (const other of sessions) if (other?.ready && other !== session) {
        showPlayer(session, other); showPlayer(other, session)
      }
    })
    async function syncView () {
      const pos = coordinates(session)
      const cx = Math.floor(pos.x / 16); const cz = Math.floor(pos.z / 16)
      if (session.center?.[0] === cx && session.center?.[1] === cz) return
      const request = Buffer.alloc(9); request[0] = slot
      request.writeInt32LE(cx, 1); request.writeInt32LE(cz, 5)
      await applyChanged(await rpc(21, request))
      if (ended) return
      const wanted = new Map()
      for (let z = cz - 2; z <= cz + 2; z++) for (let x = cx - 2; x <= cx + 2; x++) {
        if (x >= -62500 && x < 62500 && z >= -62500 && z < 62500) wanted.set(chunkKey(x, z), [x, z])
      }
      client.write('update_view_position', { chunkX: cx, chunkZ: cz })
      for (const [key, entry] of session.chunks) if (!wanted.has(key)) {
        client.write('unload_chunk', { chunkX: entry.x, chunkZ: entry.z })
        session.chunks.delete(key)
      }
      const missing = [...wanted].filter(([key]) => !session.chunks.has(key))
        .sort((a, b) => (a[1][0]-cx)**2+(a[1][1]-cz)**2 - ((b[1][0]-cx)**2+(b[1][1]-cz)**2))
      client.write('chunk_batch_start', {})
      let sent = 0
      for (const [key, [x, z]] of missing) {
        const payload = Buffer.alloc(8); payload.writeInt32LE(x); payload.writeInt32LE(z, 4)
        // Reuse an MCU-produced network copy when another player still sees this chunk.
        const shared = sessions.find(other => other && other !== session && other.chunks.has(key))
        const bytes = shared ? Buffer.from(shared.chunks.get(key).bytes) : await rpc(22, payload)
        if (ended) return
        session.chunks.set(key, { x, z, bytes })
        client.write('map_chunk', chunkPacket(bytes, x, z)); sent++
      }
      client.write('chunk_batch_finished', { batchSize: sent })
      session.center = [cx, cz]
    }
    // Coalesce movement while serial chunk streaming is busy, rather than disconnecting.
    let latestMove = null; let moveQueued = false
    const move = p => {
      if (!session.ready) return
      latestMove = p
      if (moveQueued) return
      moveQueued = true
      work(async () => {
        try {
          const current = latestMove; latestMove = null
          const b = Buffer.alloc(12)
          for (const [i, axis] of ['x', 'y', 'z'].entries()) {
            const v = Number.isFinite(current[axis]) ? Math.max(-2147483648, Math.min(2147483647, Math.round(current[axis] * 32))) : -2147483648
            b.writeInt32LE(v, i * 4)
          }
          const result = await playerRpc(8, b)
          if (ended) return
          session.position = Buffer.from(result.subarray(0, 12))
          if (Number.isFinite(current.yaw)) session.yaw = current.yaw % 360
          if (Number.isFinite(current.pitch)) session.pitch = Math.max(-90, Math.min(90, current.pitch))
          if (!result[12]) teleport(result)
          await syncView()
          if (!ended) broadcastPose(session)
        } finally {
          moveQueued = false
          if (latestMove && !ended) move(latestMove)
        }
      })
    }
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
      inventory[slot] = p.item?.itemCount > 0 ? (itemPalette.get(p.item.itemId) ?? 65535) : 65535
    })
    const edit = (p, block, sequence, action, placement = {}) => work(async () => {
      const clicked = { ...p }
      const payload = Buffer.alloc(21)
      for (const [i, axis] of ['x', 'y', 'z'].entries()) {
        const v = Number.isInteger(p[axis]) && p[axis] >= -2147483648 && p[axis] <= 2147483647 ? p[axis] : -2147483648
        payload.writeInt32LE(v, i * 4)
      }
      payload.writeUInt16LE(block, 12)
      payload[14] = action; payload[15] = placement.direction ?? 1
      payload[16] = Math.round(session.yaw * 256 / 360) & 255
      const hit = value => Number.isFinite(value) ? Math.round(Math.max(0, Math.min(1, value)) * 255) : 128
      payload[17] = hit(placement.cursorY); payload[18] = hit(placement.cursorX); payload[19] = hit(placement.cursorZ)
      payload[20] = sneaking ? 1 : 0
      const result = await playerRpc(5, payload)
      await applyChanged(result)
      p = { x: result.readInt32LE(0), y: result.readInt32LE(4), z: result.readInt32LE(8) }
      const value = result[14] | (result[18] << 8)
      const key = chunkKey(Math.floor(p.x / 16), Math.floor(p.z / 16))
      const offset = inside(p) ? index(((p.x % 16)+16)%16, p.y, ((p.z % 16)+16)%16) : -1
      if (result.length === 48 && result[13] && offset >= 0) {
        for (const viewer of sessions) {
          const entry = viewer?.chunks.get(key)
          if (entry) setBlockId(entry.bytes, offset, value)
          if (viewer?.ready && entry) viewer.client.write('block_change', { location: p, type: palette[value] })
        }
      } else if (!result[13] && !ended) {
        const corrections = [p, clicked]
        const direction = [[0,-1,0],[0,1,0],[0,0,-1],[0,0,1],[-1,0,0],[1,0,0]][placement.direction]
        if (action === 1 && direction) corrections.push({ x: clicked.x+direction[0], y: clicked.y+direction[1], z: clicked.z+direction[2] })
        for (const location of corrections) {
          if (!inside(location)) continue
          const entry = session.chunks.get(chunkKey(Math.floor(location.x/16), Math.floor(location.z/16)))
          const i = index((location.x%16+16)%16, location.y, (location.z%16+16)%16)
          if (entry) client.write('block_change', { location, type: palette[blockId(entry.bytes, i)] })
        }
        if (result[16] === 2) client.write('system_chat', { content: require('prismarine-nbt').comp({ text:
          require('prismarine-nbt').string('Micro:bit edit RAM is full. Move away from modified chunks to free it.') }), isActionBar: true })
      }
      if (!ended) client.write('acknowledge_player_digging', { sequenceId: sequence })
    })
    client.on('block_dig', p => {
      if (p.status === 0 || p.status === 2) edit(p.location, 0, p.sequence, 2)
    })
    client.on('block_place', p => {
      const d = [[0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]][p.direction]
      if (!d) return
      const block = inventory[p.hand === 1 ? 9 : selected]
      edit(p.location, block, p.sequence, 1, p)
    })
  })
  return server
}

module.exports = { createGame, chunkPacket, palette, paletteNames, itemPalette, index, positionPacket }

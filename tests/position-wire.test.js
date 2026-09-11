const test = require('node:test')
const assert = require('node:assert/strict')
const mc = require('minecraft-protocol')
const { positionPacket } = require('../host/minecraft')

test('movement bytes match vanilla 26.1 PositionMoveRotation, independently decoded', () => {
  const pos = Buffer.alloc(6)
  pos.writeInt16LE(320, 0); pos.writeInt16LE(544, 2); pos.writeInt16LE(640, 4)
  const serializer = mc.createSerializer({ state: mc.states.PLAY, isServer: true, version: '26.1' })
  const raw = serializer.createPacketBuffer({ name: 'sync_entity_position', params: positionPacket(101, pos, 90, 15) })
  let offset = 0
  function varint () {
    let v = 0; let shift = 0; let b
    do { b = raw[offset++]; v |= (b & 127) << shift; shift += 7 } while (b & 128)
    return v
  }
  varint() // Packet identifier.
  assert.equal(varint(), 101)
  // Independent layout from installed vanilla ClientboundEntityPositionSyncPacket
  // and PositionMoveRotation: two Vec3 doubles, then yaw/pitch floats and ground bool.
  for (const expected of [10, 17, 20, 0, 0, 0]) { assert.equal(raw.readDoubleBE(offset), expected); offset += 8 }
  assert.equal(raw.readFloatBE(offset), 90); offset += 4
  assert.equal(raw.readFloatBE(offset), 15); offset += 4
  assert.equal(raw[offset++], 0)
  assert.equal(offset, raw.length, 'No missing or trailing fields')
})

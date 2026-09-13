const test = require('node:test')
const assert = require('node:assert/strict')
const { once } = require('node:events')
const mc = require('minecraft-protocol')
const { createGame, palette, index } = require('../host/minecraft')
const { groups } = require('../host/data/states.json')

test('MCU multi-block responses broadcast wide states to both players', { timeout: 15000 }, async () => {
  const fake = require('./helpers/fake-mcu').fakeMCU()
  const changed = new Map()
  const door = groups.find(g => g.name === 'oak_door').start
  let request
  const rpc = async (op, p) => {
    if (op === 22) {
      const key = `${p.readInt32LE(0)},${p.readInt32LE(4)}`
      if (!changed.has(key)) {
        const legacy = await fake.rpc(op, p), wide = Buffer.alloc(65536)
        legacy.forEach((v, i) => wide.writeUInt16LE(v, i*2)); changed.set(key, wide)
      }
      return Buffer.from(changed.get(key))
    }
    if (op !== 5) return fake.rpc(op, p)
    request = Buffer.from(p)
    const bytes = changed.get('1,1')
    bytes.writeUInt16LE(door+36, index(0,8,0)*2)
    bytes.writeUInt16LE(door+44, index(0,9,0)*2)
    const reply = Buffer.alloc(56)
    reply.writeInt32LE(16); reply.writeInt32LE(8,4); reply.writeInt32LE(16,8)
    reply[13]=1; reply[17]=1; reply.writeInt32LE(1,48); reply.writeInt32LE(1,52)
    return reply
  }
  const server = createGame(rpc, null, {port:0}), clients=[]
  try {
    await once(server, 'listening')
    for (const username of ['FunctionalOne','FunctionalTwo']) {
      const c = mc.createClient({host:'127.0.0.1',port:server.socketServer.address().port,username,auth:'offline',version:'26.1'})
      clients.push(c); await once(c,'position')
    }
    const received = clients.map(c => new Promise(resolve => {
      const blocks=[]; c.on('block_change', p => { blocks.push(p); if(blocks.length===2) resolve(blocks) })
    }))
    clients[0].write('look', {yaw:90,pitch:0,flags:{}})
    clients[0].write('set_creative_slot', {slot:36,item:{itemCount:1,
      itemId:require('minecraft-data')('26.1').itemsByName.oak_door.id,
      addedComponentCount:0,removedComponentCount:0,components:[],removeComponents:[]}})
    clients[0].write('block_place',{hand:0,location:{x:16,y:7,z:16},direction:1,
      cursorX:0.25,cursorY:1,cursorZ:0.75,insideBlock:false,worldBorderHit:false,sequence:1})
    for (const blocks of await Promise.all(received)) {
      assert.deepEqual(blocks.map(b=>b.type), [palette[door+36],palette[door+44]])
      assert.deepEqual(blocks.map(b=>b.location.y), [8,9])
    }
    assert.equal(request.readInt32LE(4),7,'PC sends clicked coordinate; MCU chooses placement')
    assert.equal(request.readUInt16LE(12),door)
    assert.deepEqual([...request.subarray(14,20)],[1,1,64,255,64,191])
  } finally {
    clients.forEach(c=>c.end('Done')); Object.values(server.clients).forEach(c=>c.end('Done')); server.close()
  }
})

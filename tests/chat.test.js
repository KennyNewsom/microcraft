const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { once } = require('node:events')
const mc = require('minecraft-protocol')
const { concat } = require('minecraft-protocol/src/transforms/binaryStream')
const { ChatState, messageBytes, checksum } = require('../host/chat')
const { createGame } = require('../host/minecraft')
const ca = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
const keys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
function certificate (uuid) {
  const packet = { sessionUUID: crypto.randomUUID(), expireTime: BigInt(Date.now() + 3600000),
    publicKey: keys.publicKey.export({ format: 'der', type: 'spki' }) }
  packet.signature = crypto.sign('RSA-SHA1', concat('UUID', uuid, 'i64', packet.expireTime, 'buffer', packet.publicKey), ca.privateKey)
  return packet
}
function signed (state, seen = [], offset = 0, bits = 0, message = 'Hello from Microcraft!') {
  const packet = { message, timestamp: BigInt(Date.now()), salt: 42n, offset,
    acknowledged: Buffer.alloc(3), checksum: checksum(seen) }
  packet.acknowledged.writeUIntLE(bits, 0, 3)
  packet.signature = crypto.sign('RSA-SHA256', messageBytes(state.uuid, state.session.uuid, state.index, packet, seen), keys.privateKey)
  return packet
}
function state () {
  const s = new ChatState(crypto.randomUUID(), ca.publicKey)
  s.setSession(certificate(s.uuid))
  return s
}
test('signed chat validates certificates, message integrity and bounded acknowledgement windows', () => {
  const s = state()
  const first = signed(s)
  assert.equal(s.receive(first).index, 0)
  s.sent(first.signature)
  const reply = signed(s, [first.signature], 1, 1 << 19, 'Unicode: café 🧱')
  assert.equal(s.receive(reply).plainMessage, reply.message)
  assert.throws(() => s.receive({ ...signed(s, [first.signature], 0, 1 << 19), message: 'tampered' }), /signature/)
  assert.throws(() => state().setSession(certificate(crypto.randomUUID())), /certificate/)
  const expired = certificate(s.uuid); expired.expireTime = 0n
  assert.throws(() => s.setSession(expired), /Expired/)
  assert.throws(() => state().offset(1), /offset/)
  assert.throws(() => state().acknowledge({ offset: 0, acknowledged: Buffer.from([1, 0, 0]), checksum: 0 }), /unknown/)
  assert.throws(() => s.acknowledge({ offset: 0, acknowledged: Buffer.alloc(3), checksum: 0 }), /retracted/)
  const many = state(); const signatures = Array.from({ length: 80 }, () => crypto.randomBytes(256))
  signatures.forEach(sig => many.sent(sig))
  many.offset(64)
  assert.deepEqual(many.acknowledge({ offset: 16, acknowledged: Buffer.from([255, 255, 15]), checksum: checksum(signatures.slice(-20)) }), signatures.slice(-20))
  assert.equal(many.pending.length, 20)
  assert.throws(() => state().receive({ ...first, signature: null }), /signature/)
})

test('two wire clients receive skin properties, chat sessions and verifiable unmodified chat', { timeout: 15000 }, async () => {
  const skin = { name: 'textures', value: 'test-texture-property', signature: 'test-property-signature' }
  const server = createGame(require('./helpers/fake-mcu').fakeMCU().rpc, null,
    { port: 0, 'online-mode': true, beforeLogin: c => { c.profile = { properties: [skin] } } })
  // Test-only trust root. Production always uses Mojang's key.
  server.on('login', c => { c.microcraftChat.authority = ca.publicKey })
  server.onlineModeExceptions.chatone = true
  server.onlineModeExceptions.chattwo = true
  const clients = []
  try {
    await once(server, 'listening')
    const connect = name => {
      const c = mc.createClient({ host: '127.0.0.1', port: server.socketServer.address().port, username: name, auth: 'offline', version: '26.1' })
      clients.push(c)
      return c
    }
    const a = connect('ChatOne'); const ownInfo = once(a, 'player_info')
    const login = once(a, 'login')
    await once(a, 'position')
    assert.equal((await login)[0].enforcesSecureChat, true)
    assert.deepEqual((await ownInfo)[0].data[0].player.properties, [skin])
    const seesB = once(a, 'spawn_entity')
    const b = connect('ChatTwo'); await once(b, 'spawn_entity'); await seesB
    const serverA = Object.values(server.clients).find(c => c.username === 'ChatOne')
    const cert = certificate(a.uuid)
    const sessionA = once(a, 'player_info'); const sessionB = once(b, 'player_info')
    a.write('chat_session_update', cert)
    assert.equal((await sessionA)[0].data[0].chatSession.uuid, cert.sessionUUID)
    assert.equal((await sessionB)[0].data[0].chatSession.uuid, cert.sessionUUID)
    const first = signed(serverA.microcraftChat)
    let gotA = once(a, 'playerChat'); let gotB = once(b, 'playerChat')
    a.write('chat_message', first)
    assert.equal((await gotA)[0].verified, true)
    assert.equal((await gotB)[0].verified, true)
    const second = signed(serverA.microcraftChat, [first.signature], 1, 1 << 19, 'My house has a roof!')
    gotA = once(a, 'playerChat'); gotB = once(b, 'playerChat')
    a.write('chat_message', second)
    assert.equal((await gotA)[0].verified, true)
    const received = (await gotB)[0]
    assert.equal(received.verified, true)
    assert.equal(received.plainMessage, second.message)
    assert.equal(received.globalIndex, 1)
    const kick = once(a, 'kick_disconnect')
    a.write('chat_message', { ...signed(serverA.microcraftChat, [first.signature, second.signature], 1, (1 << 18) | (1 << 19)), message: 'forged' })
    assert.match(JSON.stringify((await kick)[0]), /signature/)
  } finally {
    clients.forEach(c => c.end('Done'))
    Object.values(server.clients).forEach(c => c.end('Done'))
    server.close()
  }
})

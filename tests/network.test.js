const test = require('node:test')
const assert = require('node:assert/strict')
const { once } = require('node:events')
const mc = require('minecraft-protocol')
const { networkSettings } = require('../host/network')
const { createGame } = require('../host/minecraft')

test('playit defaults to loopback and verified accounts; LAN remains compatible', () => {
  assert.deepEqual(networkSettings({}, ['--playit']), { playit: true, host: '127.0.0.1', port: 25565, onlineMode: true })
  assert.deepEqual(networkSettings({}, []), { playit: false, host: '0.0.0.0', port: 25565, onlineMode: false })
  assert.deepEqual(networkSettings({ MICROCRAFT_NETWORK: 'playit', MICROCRAFT_HOST: '0.0.0.0',
    MICROCRAFT_LISTEN_PORT: '25566', MICROCRAFT_ONLINE_MODE: 'true' }, []),
  { playit: true, host: '0.0.0.0', port: 25566, onlineMode: true })
  for (const port of ['0', '65536', 'foo', '25565.5']) assert.throws(() => networkSettings({ MICROCRAFT_LISTEN_PORT: port }, []))
  assert.throws(() => networkSettings({ MICROCRAFT_ONLINE_MODE: 'yes' }, []))
})

test('public mode requests account authentication before any MCU player is allocated', { timeout: 10000 }, async () => {
  let calls = 0
  const server = createGame(async () => { calls++; return Buffer.alloc(48) }, null,
    { host: '127.0.0.1', port: 0, 'online-mode': true })
  let client
  try {
    await once(server, 'listening')
    // Raw protocol client inspects the challenge without trying to use an account.
    client = new mc.Client(false, '26.1')
    const socket = require('node:net').connect(server.socketServer.address().port, '127.0.0.1')
    client.setSocket(socket)
    await once(socket, 'connect')
    const challenge = once(client, 'encryption_begin')
    client.write('set_protocol', { protocolVersion: 775, serverHost: 'example.playit.gg', serverPort: 25565, nextState: 2 })
    client.state = mc.states.LOGIN
    client.write('login_start', { username: 'PublicProbe', playerUUID: '00000000-0000-0000-0000-000000000001' })
    assert.equal((await challenge)[0].shouldAuthenticate, true)
    assert.equal(calls, 0)
  } finally {
    if (client) client.end('Test complete')
    for (const c of Object.values(server.clients)) c.end('Test complete')
    server.close()
  }
})

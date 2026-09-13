// Login packet layouts match across 775/776; inspect only the authentication
// challenge, before configuration or gameplay packets need version translation.
const mc = require('minecraft-protocol')
const net = require('node:net')
const { once } = require('node:events')
const assert = require('node:assert/strict')
async function main () {
  for (const [version, protocol] of [['26.1', 775], ['26.2', 776]]) {
    const client = new mc.Client(false, '26.1')
    client.on('error', () => {})
    const socket = net.connect(Number(process.argv[3] || 25565), process.argv[2] || '127.0.0.1')
    client.setSocket(socket)
    const timer = setTimeout(() => socket.destroy(new Error('Authentication probe timeout')), 10000)
    try {
      await once(socket, 'connect')
      const challenge = once(client, 'encryption_begin')
      client.write('set_protocol', { protocolVersion: protocol, serverHost: 'localhost', serverPort: 25565, nextState: 2 })
      client.state = mc.states.LOGIN
      client.write('login_start', { username: 'VersionAuthProbe', playerUUID: '00000000-0000-0000-0000-000000000001' })
      assert.equal((await challenge)[0].shouldAuthenticate, true)
      console.log(`${version}: account authentication required before login`)
    } finally { clearTimeout(timer); client.end('Probe complete') }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })

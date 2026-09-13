'use strict'
// A real second Java client. It sends movement only; never block edits or chat.
const mc = require('minecraft-protocol')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '..')
let flightHeight = 12
try {
  const world = fs.readFileSync(path.join(root, 'world/blocks.bin'))
  if (world.length === 32768) {
    let roof = 7
    for (let y = 8; y < 32; y++) for (let z = 8; z <= 24; z++) for (let x = 8; x <= 24; x++) {
      if (world[(y * 32 + z) * 32 + x]) roof = Math.max(roof, y)
    }
    flightHeight = Math.min(29, Math.max(10, roof + 3))
  }
} catch (err) { console.error('Using default flight height:', err.message) }
const client = mc.createClient({ host: '127.0.0.1', port: 25565, version: '26.1',
  username: 'MicroBot', auth: 'offline' })
let timer; let active = false; let tick = 0
const startup = setTimeout(() => stop('Could not join within 90 seconds', 1), 90000)
function stop (reason, code = 0) {
  clearTimeout(startup); clearInterval(timer)
  active = false
  console.log(reason)
  client.end(reason)
  process.exitCode = code
}
client.on('position', p => {
  client.write('teleport_confirm', { teleportId: p.teleportId })
  if (active) return
  clearTimeout(startup)
  active = true
  console.log(`MicroBot joined. Circling spawn at height ${flightHeight}; no blocks will be changed. PID ${process.pid}`)
  const started = performance.now()
  timer = setInterval(() => {
    const t = (performance.now() - started) / 1000 * 0.22
    client.write('position_look', { x: 16 + 6 * Math.cos(t), y: flightHeight + 0.2 * Math.sin(t * 2),
      z: 16 + 6 * Math.sin(t), yaw: -t * 180 / Math.PI, pitch: 15, flags: {} })
    if (++tick === 30) console.log('MicroBot is moving: 30 position updates sent successfully.')
  }, 100)
})
client.on('error', err => stop(err.message, 1))
client.on('kick_disconnect', p => stop('Server refused/disconnected MicroBot: ' + JSON.stringify(p), 1))
client.on('end', reason => { clearTimeout(startup); clearInterval(timer); active = false; console.log('MicroBot disconnected:', reason) })
process.on('SIGINT', () => stop('Test player stopped'))

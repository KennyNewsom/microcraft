'use strict'
const { spawn } = require('node:child_process')
const readline = require('node:readline')
const path = require('node:path')
const { createGame } = require('./minecraft')
const { networkSettings } = require('./network')
const network = networkSettings()
const compatibility = require('./compatibility')
const useCompatibility = process.env.MICROCRAFT_COMPAT !== 'false'
if (useCompatibility) compatibility.checkInstalled()
const root = path.resolve(__dirname, '..')
const serialPort = process.env.MICROCRAFT_PORT || 'COM5'
const baud = process.env.MICROCRAFT_BAUD || '230400'
const child = spawn(process.env.PYTHON || 'python', ['-u', path.join(__dirname, 'bridge.py'),
  '--port', serialPort, '--baud', baud], { cwd: root, windowsHide: true, stdio: ['pipe', 'pipe', 'inherit'] })
let game; let proxy; let identity; let nextId = 1; let stopped = false
const pending = new Map()
function stop (error) {
  if (stopped) return
  stopped = true
  console.error(error.message)
  for (const p of pending.values()) { clearTimeout(p.timer); p.reject(error) }
  pending.clear()
  proxy?.kill()
  identity?.service.close()
  if (game) {
    for (const c of Object.values(game.clients)) c.end('Micro:bit link stopped')
    game.close()
  }
  child.kill()
  process.exitCode = 1
}
function rpc (op, payload = Buffer.alloc(0)) {
  if (stopped) return Promise.reject(new Error('Bridge stopped'))
  if (pending.size >= 32) return Promise.reject(new Error('Serial queue full'))
  return new Promise((resolve, reject) => {
    const id = nextId++
    const timer = setTimeout(() => stop(new Error('Serial worker timeout')), 120000)
    pending.set(id, { resolve, reject, timer })
    child.stdin.write(JSON.stringify({ id, op, payload: payload.toString('hex') }) + '\n')
  })
}
readline.createInterface({ input: child.stdout }).on('line', line => {
  try {
    const m = JSON.parse(line)
    if (m.event === 'progress') console.log(`Startup: ${m.packets}/10000 exact echoes`)
    if (m.event === 'restored') console.log(`Streamed ${m.bytes} saved world bytes from PC; MCU readback matched`)
    if (m.event === 'fatal') return stop(new Error(m.error))
    if (m.event === 'ready') {
      console.log('Startup gate PASSED:', m.report)
      startGame().catch(stop)
    }
    if (m.id) {
      const p = pending.get(m.id)
      if (!p) throw new Error('Unexpected worker response')
      clearTimeout(p.timer); pending.delete(m.id); p.resolve(Buffer.from(m.payload, 'hex'))
    }
  } catch (err) { stop(err) }
})
child.on('error', stop)
child.on('exit', code => stop(new Error(`Serial worker exited (${code})`)))
child.stdin.on('error', stop)
process.on('SIGINT', () => { stop(new Error('Stopped by user')); process.exitCode = 0 })
async function startGame () {
  if (useCompatibility) identity = await compatibility.identityService(network.onlineMode)
  if (stopped) { identity?.service.close(); return }
  game = createGame(rpc, null, { host: useCompatibility ? '127.0.0.1' : network.host,
    port: useCompatibility ? 0 : network.port, 'online-mode': useCompatibility ? false : network.onlineMode,
    authenticatedProxy: useCompatibility && network.onlineMode,
    beforeLogin: useCompatibility ? client => {
      const p = client.forwardedProfile
      client.uuid = p.uuid; client.username = p.name; client.profile = { properties: p.properties }
    } : undefined })
  if (useCompatibility) compatibility.installIdentity(game, identity)
  game.on('listening', () => {
    if (useCompatibility) proxy = compatibility.startProxy(network, game.socketServer.address().port, identity, stop)
    console.log(`Java ${useCompatibility ? '26.1 + 26.2 compatibility starting' : '26.1 ready'} at ${network.host}:${network.port}; account verification ${network.onlineMode ? 'ON' : 'OFF'}`)
    if (network.playit) console.log(`playit: Minecraft Java/TCP tunnel -> 127.0.0.1:${network.port}; Proxy Protocol: None`)
  })
  game.on('error', stop)
  game.on('bridgeError', stop)
}

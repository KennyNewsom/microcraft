'use strict'
const { spawn } = require('node:child_process')
const readline = require('node:readline')
const path = require('node:path')
const { createGame } = require('./minecraft')
const root = path.resolve(__dirname, '..')
const serialPort = process.env.MICROCRAFT_PORT || 'COM5'
const baud = process.env.MICROCRAFT_BAUD || '230400'
const child = spawn(process.env.PYTHON || 'python', ['-u', path.join(__dirname, 'bridge.py'),
  '--port', serialPort, '--baud', baud], { cwd: root, windowsHide: true, stdio: ['pipe', 'pipe', 'inherit'] })
let game; let nextId = 1; let stopped = false
const pending = new Map()
function stop (error) {
  if (stopped) return
  stopped = true
  console.error(error.message)
  for (const p of pending.values()) { clearTimeout(p.timer); p.reject(error) }
  pending.clear()
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
    const timer = setTimeout(() => stop(new Error('Serial worker timeout')), 5000)
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
      game = createGame(rpc, Buffer.from(m.world, 'base64'), { host: process.env.MICROCRAFT_HOST || '0.0.0.0' })
      game.on('listening', () => console.log('Java 26.1: port 25565 is ready (two-player creative, LAN enabled)'))
      game.on('error', stop)
      game.on('bridgeError', stop)
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

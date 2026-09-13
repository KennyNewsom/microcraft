const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { once } = require('node:events')
const mc = require('minecraft-protocol')
const { iconProvider, readIcon } = require('../host/server-icon')
const { createGame } = require('../host/minecraft')
const original = path.join(__dirname, '../assets/microcraft-icon.png')

test('icon reloads from disk and missing or wrong-sized custom images fall back', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'microcraft-icon-'))
  const custom = path.join(dir, 'icon.png')
  try {
    const getIcon = iconProvider(custom)
    assert.equal(getIcon(), readIcon(original))
    fs.copyFileSync(original, custom)
    assert.equal(getIcon(), readIcon(custom))
    const wrongSize = fs.readFileSync(custom); wrongSize.writeUInt32BE(32, 16)
    fs.writeFileSync(custom, wrongSize)
    assert.throws(() => readIcon(custom), /64 x 64/)
    assert.equal(getIcon(), readIcon(original))
    fs.writeFileSync(custom, 'not a png')
    assert.throws(() => readIcon(custom), /PNG/)
  } finally { if (fs.existsSync(custom)) fs.unlinkSync(custom); fs.rmdirSync(dir) }
})

test('server-list status carries a PNG icon without allocating a player', async () => {
  let calls = 0
  const server = createGame(async () => { calls++; throw new Error('Unexpected MCU call') }, null, { port: 0 })
  try {
    await once(server, 'listening')
    const status = await mc.ping({ host: '127.0.0.1', port: server.socketServer.address().port, version: '26.1' })
    assert.equal(status.favicon, readIcon(path.join(__dirname, '../server-icon.png')))
    assert.equal(calls, 0)
  } finally { server.close() }
})

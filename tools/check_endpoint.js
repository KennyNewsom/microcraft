'use strict'
const mc = require('minecraft-protocol')
const host = process.argv[2] || '127.0.0.1'
const port = Number(process.argv[3] || 25565)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port')
mc.ping({ host, port, version: '26.1', closeTimeout: 15000 }, (error, status) => {
  if (error) { console.error(error.message); process.exitCode = 1; return }
  console.log(JSON.stringify({ host, port, version: status.version, players: status.players,
    description: status.description, latency: status.latency }, null, 2))
})

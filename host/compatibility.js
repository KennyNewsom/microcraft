'use strict'
const http = require('node:http')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')
const root = path.resolve(__dirname, '..')
const directory = path.join(root, '.tools', 'viaproxy')
const jar = path.join(directory, 'ViaProxy-3.4.12.jar')

function javaExecutable () {
  if (process.env.JAVA_HOME) return path.join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
  const installed = 'C:/Program Files/Java/jdk-26.0.1/bin/java.exe'
  return fs.existsSync(installed) ? installed : 'java'
}

async function identityService (onlineMode) {
  const token = crypto.randomBytes(32).toString('hex')
  const identities = new Map()
  const service = http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/identity' || req.headers.authorization !== `Bearer ${token}`) {
      res.writeHead(403).end(); return
    }
    let body = ''; let size = 0
    req.on('data', part => { size += part.length; if (size > 65536) req.destroy(); else body += part })
    req.on('end', () => {
      try {
        const p = JSON.parse(body)
        if (!Number.isInteger(p.port) || p.port < 1 || p.port > 65535 ||
          !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(p.uuid) ||
          !/^[A-Za-z0-9_]{1,16}$/.test(p.name) || p.authenticated !== onlineMode ||
          !Array.isArray(p.properties) || p.properties.length > 16 ||
          p.properties.some(v => typeof v.name !== 'string' || typeof v.value !== 'string' || (v.signature !== undefined && typeof v.signature !== 'string'))) throw new Error('Invalid identity')
        for (const [port, value] of identities) if (value.expires < Date.now()) identities.delete(port)
        if (identities.size >= 128) throw new Error('Identity queue full')
        identities.set(p.port, { ...p, expires: Date.now() + 10000 })
        res.writeHead(204).end()
      } catch { res.writeHead(400).end() }
    })
  })
  await new Promise((resolve, reject) => { service.once('error', reject); service.listen(0, '127.0.0.1', resolve) })
  return { service, token, url: `http://127.0.0.1:${service.address().port}/identity`,
    consume (client, name) {
      const p = identities.get(client.socket.remotePort)
      identities.delete(client.socket.remotePort)
      if (!p || p.expires < Date.now() || p.name !== name) throw new Error('Connect through the Microcraft compatibility port.')
      return p
    }
  }
}

function installIdentity (server, identities) {
  server.on('connection', client => {
    const login = client.listeners('login_start')
    client.removeAllListeners('login_start')
    client.once('login_start', packet => {
      try { client.forwardedProfile = identities.consume(client, packet.username) }
      catch (error) { client.end(error.message); return }
      for (const handler of login) handler.call(client, packet)
    })
  })
}

function startProxy (network, backendPort, identity, onFailure) {
  const config = path.join(directory, 'microcraft.yml')
  fs.writeFileSync(config, `bind-address: ${JSON.stringify(`${network.host}:${network.port}`)}\ntarget-address: 127.0.0.1:${backendPort}\ntarget-version: '26.1'\nproxy-online-mode: ${network.onlineMode}\nauth-method: NONE\nchat-signing: true\nignore-protocol-translation-errors: false\nwildcard-domain-handling: NONE\ncompression-threshold: 256\n`)
  const child = spawn(javaExecutable(), ['-Xmx512m', '-jar', jar, 'config', config], {
    cwd: directory, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, MICROCRAFT_IDENTITY_URL: identity.url, MICROCRAFT_IDENTITY_TOKEN: identity.token }
  })
  child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr)
  child.on('error', onFailure)
  child.on('exit', code => onFailure(new Error(`Version proxy exited (${code})`)))
  return child
}

function checkInstalled () {
  if (!fs.existsSync(jar) || !fs.existsSync(path.join(directory, 'plugins', 'MicrocraftIdentity.jar'))) {
    throw new Error('Run npm.cmd run setup:versions before starting version compatibility mode.')
  }
}
module.exports = { identityService, installIdentity, startProxy, checkInstalled, javaExecutable }

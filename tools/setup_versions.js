'use strict'
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')
const { javaExecutable } = require('../host/compatibility')
const root = path.resolve(__dirname, '..')
const directory = path.join(root, '.tools', 'viaproxy')
const jar = path.join(directory, 'ViaProxy-3.4.12.jar')
const hash = '32ce9ad871aeb03286823c29da262ebd75992864e7857db283f103525c7fc0cb'
async function main () {
  fs.mkdirSync(path.join(directory, 'plugins'), { recursive: true })
  if (!fs.existsSync(jar)) {
    const response = await fetch('https://github.com/ViaVersion/ViaProxy/releases/download/v3.4.12/ViaProxy-3.4.12.jar')
    if (!response.ok) throw new Error(`Download failed: ${response.status}`)
    const bytes = Buffer.from(await response.arrayBuffer())
    if (crypto.createHash('sha256').update(bytes).digest('hex') !== hash) throw new Error('ViaProxy checksum mismatch')
    fs.writeFileSync(jar, bytes)
  }
  if (crypto.createHash('sha256').update(fs.readFileSync(jar)).digest('hex') !== hash) throw new Error('ViaProxy checksum mismatch')
  const classes = path.join(directory, 'classes')
  fs.mkdirSync(classes, { recursive: true })
  const java = javaExecutable()
  const tool = name => path.isAbsolute(java) ? path.join(path.dirname(java), name + (process.platform === 'win32' ? '.exe' : '')) : name
  execFileSync(tool('javac'), ['--release', '17', '-cp', jar, '-d', classes, path.join(root, 'proxy', 'MicrocraftIdentity.java')], { stdio: 'inherit', windowsHide: true })
  fs.copyFileSync(path.join(root, 'proxy', 'viaproxy.yml'), path.join(classes, 'viaproxy.yml'))
  execFileSync(tool('jar'), ['cf', path.join(directory, 'plugins', 'MicrocraftIdentity.jar'), '-C', classes, '.'], { stdio: 'inherit', windowsHide: true })
  console.log('Verified ViaProxy 3.4.12 and built Microcraft identity plugin.')
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })

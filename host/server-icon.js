'use strict'
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '..')
const fallback = path.join(root, 'assets', 'microcraft-icon.png')

function readIcon (filename) {
  const stat = fs.statSync(filename)
  if (stat.size > 65536) throw new Error('Server icon must be smaller than 64 KiB')
  const bytes = fs.readFileSync(filename)
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) ||
    bytes.toString('ascii', 12, 16) !== 'IHDR' || bytes.readUInt32BE(16) !== 64 || bytes.readUInt32BE(20) !== 64) {
    throw new Error('Server icon must be a 64 x 64 PNG')
  }
  return 'data:image/png;base64,' + bytes.toString('base64')
}

function iconProvider (filename = process.env.MICROCRAFT_ICON || path.join(root, 'server-icon.png')) {
  const defaultIcon = readIcon(fallback)
  let lastWarning
  return () => {
    try { const icon = readIcon(filename); lastWarning = undefined; return icon }
    catch (error) {
      if (error.code !== 'ENOENT' && error.message !== lastWarning) {
        console.warn(`Server icon: ${error.message}; using default Microcraft icon.`)
        lastWarning = error.message
      }
      return defaultIcon
    }
  }
}
module.exports = { iconProvider, readIcon }

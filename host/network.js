'use strict'

function networkSettings (env = process.env, args = process.argv.slice(2)) {
  const playit = args.includes('--playit') || env.MICROCRAFT_NETWORK === 'playit'
  const rawPort = env.MICROCRAFT_LISTEN_PORT || '25565'
  if (!/^\d+$/.test(rawPort) || Number(rawPort) < 1 || Number(rawPort) > 65535) {
    throw new Error('MICROCRAFT_LISTEN_PORT must be an integer from 1 to 65535')
  }
  const auth = env.MICROCRAFT_ONLINE_MODE
  if (auth !== undefined && auth !== 'true' && auth !== 'false') {
    throw new Error('MICROCRAFT_ONLINE_MODE must be true or false')
  }
  return {
    playit,
    host: env.MICROCRAFT_HOST || (playit ? '127.0.0.1' : '0.0.0.0'),
    port: Number(rawPort),
    onlineMode: auth === undefined ? playit : auth === 'true'
  }
}

module.exports = { networkSettings }

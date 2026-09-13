const test = require('node:test')
const assert = require('node:assert/strict')
const { identityService } = require('../host/compatibility')

test('identity handoff requires secret, verified mode, matching connection and single use', async () => {
  const identity = await identityService(true)
  try {
    const profile = { port: 12345, name: 'Player', uuid: '12345678-1234-1234-1234-123456789abc', authenticated: true, properties: [] }
    const send = (token, body) => fetch(identity.url, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(body) })
    assert.equal((await send('incorrect', profile)).status, 403)
    assert.equal((await send(identity.token, { ...profile, authenticated: false })).status, 400)
    assert.equal((await send(identity.token, profile)).status, 204)
    assert.throws(() => identity.consume({ socket: { remotePort: 12346 } }, 'Player'))
    assert.equal(identity.consume({ socket: { remotePort: 12345 } }, 'Player').uuid, profile.uuid)
    assert.throws(() => identity.consume({ socket: { remotePort: 12345 } }, 'Player'))
  } finally { identity.service.closeAllConnections(); identity.service.close() }
})

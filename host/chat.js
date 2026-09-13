'use strict'
const crypto = require('node:crypto')
const nbt = require('prismarine-nbt')
const { concat } = require('minecraft-protocol/src/transforms/binaryStream')
const { mojangPublicKeyPem } = require('minecraft-protocol/src/server/constants')
const text = value => nbt.comp({ text: nbt.string(value) })

function checksum (signatures) {
  let hash = 1
  for (const signature of signatures) {
    let part = 1
    for (const byte of signature) part = (31 * part + (byte > 127 ? byte - 256 : byte)) | 0
    hash = (31 * hash + part) | 0
  }
  return (hash & 255) || 1
}
function messageBytes (uuid, session, index, packet, seen) {
  return concat('i32', 1, 'UUID', uuid, 'UUID', session, 'i32', index,
    'i64', packet.salt, 'i64', packet.timestamp / 1000n,
    'i32', Buffer.byteLength(packet.message, 'utf8'), 'pstring', packet.message,
    'i32', seen.length, 'buffer', Buffer.concat(seen))
}

// PC-side network authentication only. No world data or MCU allocations.
class ChatState {
  constructor (uuid, authority = mojangPublicKeyPem) {
    this.uuid = uuid
    this.authority = authority
    this.pending = Array(20).fill(null)
    this.index = 0
    this.globalIndex = 0
    this.lastTimestamp = 0n
  }

  setSession (packet) {
    if (packet.expireTime <= BigInt(Date.now())) throw new Error('Expired chat key; restart Minecraft to refresh it.')
    const key = crypto.createPublicKey({ key: packet.publicKey, format: 'der', type: 'spki' })
    if (key.asymmetricKeyType !== 'rsa' || key.asymmetricKeyDetails.modulusLength !== 2048) throw new Error('Invalid chat key')
    const bytes = concat('UUID', this.uuid, 'i64', packet.expireTime, 'buffer', packet.publicKey)
    if (!crypto.verify('RSA-SHA1', bytes, this.authority, packet.signature)) throw new Error('Invalid chat certificate')
    const next = { uuid: packet.sessionUUID, publicKey: { expireTime: packet.expireTime,
      keyBytes: packet.publicKey, keySignature: packet.signature } }
    if (this.session) {
      if (this.session.uuid === next.uuid && this.session.publicKey.keyBytes.equals(packet.publicKey)) return false
      if (packet.expireTime < this.session.publicKey.expireTime) throw new Error('Out-of-order chat key')
    }
    this.key = key
    this.session = next
    this.index = 0
    return true
  }

  offset (count) {
    if (!Number.isInteger(count) || count < 0 || count > this.pending.length - 20) throw new Error('Invalid chat acknowledgement offset')
    this.pending.splice(0, count)
  }

  acknowledge (packet) {
    this.offset(packet.offset)
    if (!Buffer.isBuffer(packet.acknowledged) || packet.acknowledged.length !== 3 || packet.acknowledged[2] & 240) throw new Error('Invalid chat acknowledgement')
    const bits = packet.acknowledged.readUIntLE(0, 3)
    const seen = []
    for (let i = 0; i < 20; i++) {
      const entry = this.pending[i]
      if (bits & (1 << i)) {
        if (!entry) throw new Error('Acknowledged unknown chat message')
        entry.pending = false
        seen.push(entry.signature)
      } else {
        if (entry && !entry.pending) throw new Error('Chat acknowledgement was retracted')
        this.pending[i] = null
      }
    }
    if (packet.checksum !== 0 && packet.checksum !== checksum(seen)) throw new Error('Chat acknowledgement checksum mismatch')
    return seen
  }

  receive (packet) {
    if (!this.session || this.session.publicKey.expireTime <= BigInt(Date.now())) throw new Error('Missing or expired chat key; restart Minecraft to refresh it.')
    if (typeof packet.message !== 'string' || packet.message.length > 256 || /[\u0000-\u001f\u007f\u00a7]/u.test(packet.message)) throw new Error('Invalid chat text')
    if (packet.timestamp < this.lastTimestamp || packet.timestamp > BigInt(Date.now() + 300000) || packet.timestamp < BigInt(Date.now() - 300000)) throw new Error('Invalid chat timestamp')
    const seen = this.acknowledge(packet)
    if (!Buffer.isBuffer(packet.signature) || packet.signature.length !== 256 ||
      !crypto.verify('RSA-SHA256', messageBytes(this.uuid, this.session.uuid, this.index, packet, seen), this.key, packet.signature)) throw new Error('Chat signature validation failed')
    this.lastTimestamp = packet.timestamp
    return { senderUuid: this.uuid, index: this.index++, signature: packet.signature,
      plainMessage: packet.message, timestamp: packet.timestamp, salt: packet.salt,
      previousMessages: seen.map(signature => ({ id: 0, signature })),
      unsignedChatContent: undefined, filterType: 0, type: { chatType: 0 }, networkTargetName: undefined }
  }

  sent (signature) {
    if (!this.lastPending?.equals(signature)) {
      this.pending.push({ signature, pending: true })
      this.lastPending = signature
    }
    if (this.pending.length > 4096) throw new Error('Too many unacknowledged chat messages')
  }
}

function installChat (server, sessions, secure) {
  server.on('login', client => {
    // Replace the dependency's older handler: it reads sessionUuid instead of
    // 26.1's sessionUUID and does not maintain a usable acknowledgement tracker.
    for (const event of ['chat_session_update', 'chat_message', 'message_acknowledgement']) client.removeAllListeners(event)
    client.microcraftChat = new ChatState(client.uuid)
    client.on('settings', packet => { client.settings = packet })
    let failed = false
    let budget = 40; let budgetTime = Date.now()
    const guard = fn => packet => {
      if (failed) return
      try { fn(packet) } catch (err) { failed = true; client.end(err.message) }
    }
    client.on('chat_session_update', guard(packet => {
      if (!client.microcraftChat.setSession(packet)) return
      const subject = sessions.find(s => s?.client === client)
      if (subject?.ready) for (const viewer of sessions) if (viewer?.ready) {
        viewer.client.write('player_info', { action: { initialize_chat: true },
          data: [{ uuid: client.uuid, chatSession: client.microcraftChat.session }] })
      }
    }))
    client.on('message_acknowledgement', guard(packet => client.microcraftChat.offset(packet.count)))
    const unsupportedCommand = guard(packet => {
      if (packet.acknowledged) client.microcraftChat.acknowledge({ ...packet, offset: packet.messageCount })
      if (packet.argumentSignatures?.length) throw new Error('Signed commands are not supported by Microcraft yet.')
      client.write('system_chat', { content: text('Microcraft does not support slash commands yet.'), isActionBar: false })
    })
    client.on('chat_command', unsupportedCommand)
    client.on('chat_command_signed', unsupportedCommand)
    client.on('chat_message', guard(packet => {
      const now = Date.now()
      budget = Math.min(40, budget + (now - budgetTime) / 1000); budgetTime = now
      if (--budget < 0) throw new Error('Chat sent too quickly')
      const subject = sessions.find(s => s?.client === client)
      if (!secure && !client.microcraftChat.session) {
        if (typeof packet.message !== 'string' || packet.message.length > 256) throw new Error('Invalid chat text')
        for (const viewer of sessions) if (viewer?.ready && viewer.client.settings?.chatFlags !== 2) {
          viewer.client.write('system_chat', { content: text(`<${client.username}> ${packet.message}`), isActionBar: false })
        }
        return
      }
      const message = client.microcraftChat.receive(packet)
      if (!subject?.ready) return
      for (const viewer of sessions) if (viewer?.ready && (!viewer.client.settings?.chatFlags)) {
        const state = viewer.client.microcraftChat
        viewer.client.write('player_chat', { ...message, globalIndex: state.globalIndex++, networkName: text(client.username) })
        try { state.sent(message.signature) } catch (err) { viewer.client.end(err.message) }
      }
    }))
  })
}

module.exports = { ChatState, installChat, messageBytes, checksum }

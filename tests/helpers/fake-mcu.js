const fakeMCU = () => {
  const players = Array(4).fill(null); const chunks = new Map(); const calls = []; const views = new Map()
  const rpc = async (op, p) => {
    const actor = p[47]; calls.push([op, actor, Buffer.from(p)])
    const reply = Buffer.alloc(48)
    if (op === 21) { views.set(p[0], [p.readInt32LE(1), p.readInt32LE(5)]); return Buffer.alloc(0) }
    if (op === 22) {
      const key = `${p.readInt32LE(0)},${p.readInt32LE(4)}`
      if (!chunks.has(key)) {
        const bytes = Buffer.alloc(32768)
        for (let i = 0; i < bytes.length; i++) bytes[i] = i % 128 === 0 ? 1 : i % 128 < 7 ? 2 : i % 128 === 7 ? 3 : 0
        chunks.set(key, bytes)
      }
      return Buffer.from(chunks.get(key))
    }
    if (op === 9) { players[actor] = [512 + actor * 64, 320, 512]; reply[12] = 1 }
    if (op === 8) { players[actor] = [0, 4, 8].map(i => p.readInt32LE(i)); reply[12] = 1 }
    if (op === 5) {
      let [x, y, z] = [0, 4, 8].map(i => p.readInt32LE(i))
      if (p[14] === 1) { const d = [[0,-1,0],[0,1,0],[0,0,-1],[0,0,1],[-1,0,0],[1,0,0]][p[15]]; x+=d[0]; y+=d[1]; z+=d[2] }
      reply.writeInt32LE(x); reply.writeInt32LE(y,4); reply.writeInt32LE(z,8)
      const bytes = chunks.get(`${Math.floor(x / 16)},${Math.floor(z / 16)}`)
      const index = (((z % 16 + 16) % 16) * 16 + (x % 16 + 16) % 16) * 128 + y
      reply[13] = bytes && y > 0 && y < 128 && p.readUInt16LE(12) < 255 ? 1 : 0
      if (reply[13]) bytes[index] = p[12]
      reply[14] = bytes?.[index] ?? 0
    } else if (players[actor]) players[actor].forEach((v, i) => reply.writeInt32LE(v, i * 4))
    if (op === 10) { players[actor] = null; views.delete(actor) }
    return reply
  }
  return { rpc, players, chunks, calls, views }
}
module.exports = { fakeMCU }

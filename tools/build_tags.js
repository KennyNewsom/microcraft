// Resolve nested vanilla tags to the numeric IDs used by our advertised registries.
const fs = require('node:fs')
const path = require('node:path')
const data = require('minecraft-data')('26.1')
const raw = JSON.parse(fs.readFileSync(0, 'utf8'))
const registries = Object.fromEntries(Object.entries(data.loginPacket.dimensionCodec)
  .map(([name, value]) => [name.replace('minecraft:', ''), Object.fromEntries(value.entries.map((e, i) => [e.key, i]))]))
for (const [registry, values] of Object.entries({ block: data.blocksArray, item: data.itemsArray, entity_type: data.entitiesArray })) {
  registries[registry] = Object.fromEntries(values.map(v => ['minecraft:' + v.name, v.id]))
}
const packet = { tags: [] }
for (const [registry, ids] of Object.entries(registries)) {
  const cache = new Map()
  function resolve (name, visiting = new Set()) {
    if (cache.has(name)) return cache.get(name)
    if (visiting.has(name)) throw new Error(`Tag cycle: ${registry}/${name}`)
    const tag = raw[registry + '/' + name.replace('minecraft:', '')]
    if (!tag) throw new Error(`Missing tag ${registry}/${name}`)
    const next = new Set(visiting).add(name)
    const entries = new Set()
    for (const entry of tag.values) {
      const id = typeof entry === 'string' ? entry : entry.id
      try {
        if (id.startsWith('#')) for (const v of resolve(id.slice(1), next)) entries.add(v)
        else if (ids[id] !== undefined) entries.add(ids[id])
        else throw new Error(`Unknown registry entry ${registry}/${id}`)
      } catch (err) { if (typeof entry === 'string' || entry.required !== false) throw err }
    }
    cache.set(name, [...entries])
    return cache.get(name)
  }
  const names = Object.keys(raw).filter(n => n.startsWith(registry + '/')).map(n => 'minecraft:' + n.slice(registry.length + 1))
  if (names.length) packet.tags.push({ tagType: 'minecraft:' + registry,
    tags: names.sort().map(tagName => ({ tagName, entries: resolve(tagName) })) })
}
const directory = path.join(__dirname, '../host/data')
fs.mkdirSync(directory, { recursive: true })
fs.writeFileSync(path.join(directory, 'tags-26.1.json'), JSON.stringify(packet))
console.log(`Generated ${packet.tags.reduce((n, r) => n + r.tags.length, 0)} tags across ${packet.tags.length} registries`)

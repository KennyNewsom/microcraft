'use strict'
// Compatibility entry point: the old fixed-world probe is superseded.
require('./probe_streaming').main().catch(err => { console.error(err); process.exitCode = 1 })

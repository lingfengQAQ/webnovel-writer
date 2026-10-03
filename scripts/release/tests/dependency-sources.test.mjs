import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { createHash } from 'node:crypto'
import { verifyRegistrySources } from '../dependency-sources.mjs'

test('registry source exception requires exact archive bytes and complete pinned TypeScript source', () => {
  const body = Buffer.from('export const original = true\n')
  const header = Buffer.alloc(512)
  header.write('package/src/index.ts')
  header.write(body.length.toString(8).padStart(11, '0'), 124)
  header.write('0', 156)
  const bytes = zlib.gzipSync(Buffer.concat([header, body, Buffer.alloc(512 - body.length), Buffer.alloc(1024)]))
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'scriptor-source-proof-'))
  const file = path.join(directory, 'source.tgz')
  fs.writeFileSync(file, bytes)
  const sha = value => createHash('sha256').update(value).digest('hex')
  const pin = { integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`, sourceFiles: 1,
    sourceSha256: sha(`src/index.ts\0${sha(body)}\n`) }
  try {
    assert.equal(verifyRegistrySources(file, pin).sourceFiles, 1)
    assert.throws(() => verifyRegistrySources(file, { ...pin, integrity: 'sha512-invalid' }), /integrity mismatch/)
    assert.throws(() => verifyRegistrySources(file, { ...pin, sourceFiles: 2 }), /file count mismatch/)
    assert.throws(() => verifyRegistrySources(file, { ...pin, sourceSha256: '0'.repeat(64) }), /content mismatch/)
  } finally { fs.unlinkSync(file); fs.rmdirSync(directory) }
})

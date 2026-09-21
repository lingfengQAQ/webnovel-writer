/** Local first-publication fixture: serve exact release bytes; proxy other public packages. */
import fs from 'node:fs'
import path from 'node:path'
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { packageFiles } from './tar.mjs'

const packages = process.argv.slice(2).map(filename => {
  const manifest = JSON.parse(packageFiles(filename).get('package.json'))
  const bytes = fs.readFileSync(filename)
  return { manifest, bytes, file: path.basename(filename), integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}` }
})
const publishedAt = new Date().toISOString()
const server = createServer((request, response) => {
  if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405); response.end(); return }
  const url = new URL(request.url, 'http://localhost')
  const name = decodeURIComponent(url.pathname.slice(1))
  const tarball = packages.find(item => name === `tarballs/${item.file}`)
  if (tarball) { response.writeHead(200, { 'content-type': 'application/octet-stream' }); response.end(tarball.bytes); return }
  const pkg = packages.find(item => name === item.manifest.name)
  if (!pkg) {
    response.writeHead(307, { location: `https://registry.npmjs.org${url.pathname}${url.search}` })
    response.end()
    return
  }
  const origin = `http://127.0.0.1:${server.address().port}`
  response.writeHead(200, { 'content-type': 'application/json' })
  response.end(JSON.stringify({ name, 'dist-tags': { preview: pkg.manifest.version },
    time: { created: publishedAt, modified: publishedAt, [pkg.manifest.version]: publishedAt },
    versions: { [pkg.manifest.version]: { ...pkg.manifest, dist: { tarball: `${origin}/tarballs/${pkg.file}`, integrity: pkg.integrity } } } }))
})
server.listen(0, '127.0.0.1', () => console.log(`http://127.0.0.1:${server.address().port}/`))

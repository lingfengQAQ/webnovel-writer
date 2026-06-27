import path from 'node:path'
import os from 'node:os'
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises'

// 在临时目录造一个最小书仓库（Writer/定稿 测试用），files = {相对路径: 内容}
export async function makeRepo(files = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wnw-w-'))
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel)
    await mkdir(path.dirname(full), { recursive: true })
    await writeFile(full, content, 'utf8')
  }
  return root
}

export async function cleanup(root) {
  await rm(root, { recursive: true, force: true })
}

export function read(root, rel) {
  return readFile(path.join(root, rel), 'utf8')
}

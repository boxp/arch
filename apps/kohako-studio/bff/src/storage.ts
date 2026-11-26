import { open, readFile, rename, mkdir, unlink } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'
export async function load<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return fallback
    if (e instanceof SyntaxError) {
      await rename(path, `${path}.corrupt-${Date.now()}`)
      return fallback
    }
    throw e
  }
}
/** keep が false を返したら（呼ぶ側がこの書き込みを捨てた）、ファイルを置き換えずに投げる。 */
export async function atomic(path: string, value: unknown, keep?: () => boolean) {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.${randomUUID()}.tmp`,
    file = await open(tmp, 'wx', 0o600)
  try {
    await file.writeFile(JSON.stringify(value))
    await file.sync()
  } finally {
    await file.close()
  }
  if (keep && !keep()) {
    await unlink(tmp).catch(() => undefined)
    throw Error('abandoned write')
  }
  await rename(tmp, path)
}

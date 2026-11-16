import { open, readFile, rename, mkdir } from 'node:fs/promises'
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
export async function atomic(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.${randomUUID()}.tmp`,
    file = await open(tmp, 'wx', 0o600)
  try {
    await file.writeFile(JSON.stringify(value))
    await file.sync()
  } finally {
    await file.close()
  }
  await rename(tmp, path)
}

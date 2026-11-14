/**
 * Pre-flight smoke test for the built host bundle: load lib/index.js, feed it
 * a fake cordis ctx backed by the REAL filesystem, and check that
 * `gatherContext` grounds the rewrite on both the session history and the
 * workspace — and that a secret-bearing file is never read.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const ROOT = join(tmpdir(), 'dsh-pe-preflight')
mkdirSync(join(ROOT, 'src'), { recursive: true })
mkdirSync(join(ROOT, 'node_modules', 'leftpad'), { recursive: true })
writeFileSync(join(ROOT, 'README.md'), '# Preflight Project\nThis project builds a widget.\n')
writeFileSync(join(ROOT, 'package.json'), '{"name":"preflight","version":"1.0.0"}\n')
writeFileSync(join(ROOT, 'src', 'main.ts'), 'export const widget = () => 42\n')
writeFileSync(join(ROOT, '.env'), 'API_KEY=super-secret-value\n')
writeFileSync(join(ROOT, 'server.key'), 'PRIVATE-KEY-MATERIAL\n')
writeFileSync(join(ROOT, 'node_modules', 'leftpad', 'index.js'), 'module.exports = 1\n')

/** A minimal ctx.fs over node:fs — the same three methods the real backend has. */
const fsFace = {
  async resolve(path) {
    const absolute = resolve(path)
    return { targetKey: absolute, displayPath: absolute }
  },
  async listDir(target) {
    const entries = await readdir(target.targetKey, { withFileTypes: true })
    return entries.map((entry) => ({
      name: entry.name,
      type: entry.isDirectory() ? 'directory' : 'file',
      target: { targetKey: join(target.targetKey, entry.name), displayPath: entry.name },
    }))
  },
  async readText(target) {
    const info = await stat(target.targetKey)
    if (!info.isFile()) throw new Error('not a file')
    return await readFile(target.targetKey, 'utf8')
  },
}

const session = {
  deriveMessages: () => [
    { role: 'user', content: [{ type: 'text', text: '我在做 preflight widget 项目' }] },
    { role: 'assistant', content: [{ type: 'text', text: '明白，用 src/main.ts 里的 widget' }, { type: 'tool-call' }] },
  ],
  header: { cwd: ROOT },
}

const ctx = {
  get: (name) => {
    if (name === 'sessions') return { get: (id) => (id === 's1' ? session : undefined) }
    if (name === 'fs') return fsFace
    if (name === 'llm') return { stream: () => ({ [Symbol.asyncIterator]: async function* () {} }) }
    return undefined
  },
  inject: () => {},
  effect: () => () => {},
}

// Load the COMMITTED host bundle by a path relative to this script. The
// absolute path this used to carry (a URL-encoded local checkout) only ever
// worked on the machine that wrote it, so the one check that exercises the
// built artifact could not run anywhere else — and in CI it pointed at a
// directory that does not exist.
const mod = await import(new URL('../lib/index.js', import.meta.url).href)
console.log('exports:', Object.keys(mod).filter((k) => !k.startsWith('_')).join(', '))

const bundle = await mod.gatherContext(ctx, 's1', { ...mod.DEFAULT_CONFIG }, '继续优化')
console.log('history:', bundle.history, 'workspace:', bundle.workspace, 'files:', bundle.files, 'chars:', bundle.block.length)
console.log('has conversation block:', bundle.block.includes('<conversation_context>'))
console.log('has workspace block  :', bundle.block.includes('<workspace_context>'))
console.log('has README excerpt   :', bundle.block.includes('Preflight Project'))
console.log('has src/main.ts      :', bundle.block.includes('src/main.ts'))
console.log('LEAKED .env          :', bundle.block.includes('super-secret-value'))
console.log('LEAKED server.key    :', bundle.block.includes('PRIVATE-KEY-MATERIAL'))
console.log('ENTERED node_modules :', bundle.block.includes('node_modules'))
console.log('--- block (head) ---')
console.log(bundle.block.split('\n').slice(0, 26).join('\n'))

// The system prompt must gain exactly the rules the layers can support.
const withRules = mod.withWorkspaceRules(mod.withContextRules(mod.DEFAULT_SYSTEM_PROMPT))
console.log('--- workspace rules present:', withRules.includes('Workspace context'), '| conversation rules:', withRules.includes('Conversation context'))

// apply() must never throw on a minimal composition (boot safety).
const applied = mod.apply(ctx, { ...mod.DEFAULT_CONFIG })
console.log('apply() returned without throwing:', applied === undefined)

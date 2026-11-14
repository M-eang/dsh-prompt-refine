/**
 * Workspace grounding: turn the session's working directory into one bounded,
 * neutralized snippet the rewrite can be anchored on.
 *
 * The scan is deliberately shallow, cheap, and total-budgeted:
 * - **Never a project dump.** Directory depth, listed entries, file count and
 *   character budget are all capped, so a huge repository costs the same as a
 *   small one and the model never receives the whole tree.
 * - **Never a secret.** Obviously secret-bearing names (`.env*`, `*.key`,
 *   `*.pem`, `credentials*`, …) are skipped before a single byte is read, so a
 *   stray key file can never be shipped to the model provider.
 * - **Fail open to the original behaviour.** No `fs` service, no working
 *   directory, an unreadable root, or any provider throw all yield
 *   `undefined`, and the caller runs the enhancement exactly as it did before
 *   this module existed.
 * @module dsh-prompt-refine/workspace
 */

/** Structural face of one resolved filesystem target (`ctx.fs` backend shape). */
export interface FsTargetLike {
  targetKey: string
  displayPath: string
}

/** Structural face of one directory entry returned by `fs.listDir`. */
export interface FsEntryLike {
  name: string
  type: string
  target: FsTargetLike
  size?: number
}

/**
 * Structural face of the `ctx.fs` service.
 *
 * Only three methods are declared: the plugin never writes, never stats, and
 * never watches. A backend that speaks the service definition answers all
 * three (verified against `@deepseek-ai/dsh-fs-local` on dsh 0.2.0-rc.2:
 * `resolve(path, opts)` → target, `listDir(target, signal)` → entries,
 * `readText(target, signal)` → UTF-8 text).
 */
export interface FsFace {
  resolve(path: string, opts?: { cwd?: string; signal?: AbortSignal }): Promise<FsTargetLike>
  listDir(target: FsTargetLike, signal?: AbortSignal): Promise<readonly FsEntryLike[]>
  readText(target: FsTargetLike, signal?: AbortSignal): Promise<string>
}

/** Bounds of one workspace scan (all resolved from plugin settings). */
export interface WorkspaceOptions {
  /**
   * Maximum directory nesting depth admitted: the number of levels listed
   * below the scanned root, so `2` lists the root's own entries plus their
   * entries and never anything deeper. The setting states the same bound one
   * level up ("the root counts as level 1"); the root is this counter's 0,
   * which is the base the traversal below actually walks with.
   */
  maxDepth: number
  /** Maximum entries listed in the directory-structure section. */
  treeMax: number
  /** Maximum files whose excerpt is included. */
  maxFiles: number
  /** Character cap of one file excerpt. */
  maxFileChars: number
  /** Character cap of all file excerpts together. */
  maxChars: number
}

/** One file admitted into the snippet. */
export interface WorkspaceFile {
  /** Path relative to the scanned root, using `/`. */
  path: string
  /** Bounded, tag-neutralized excerpt. */
  snippet: string
}

/** The assembled scan handed to the formatter. */
export interface WorkspaceScan {
  /** Display path of the scanned root (never the raw target key). */
  root: string
  /** Relative directory/file entries, directories suffixed with `/`. */
  tree: string[]
  /** Bounded file excerpts, highest-priority first. */
  files: WorkspaceFile[]
  /** True when a budget cut the scan short. */
  truncated: boolean
}

/** Directories never descended into (build output, vendor trees, VCS). */
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.hg', '.svn', 'dist', 'build', 'out', 'target',
  '.next', '.nuxt', '.cache', '.turbo', '.output', '.parcel-cache',
  '__pycache__', '.venv', 'venv', 'env', 'coverage', '.idea', '.vscode',
  '.pnpm-store', 'bower_components', 'vendor',
])

/** Extensions never read as text (binaries, media, archives, lockfiles). */
const SKIP_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.svg', '.tif', '.tiff',
  '.mp3', '.wav', '.flac', '.ogg', '.mp4', '.mov', '.avi', '.mkv', '.webm',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.zip', '.tar', '.gz', '.tgz', '.bz2', '.xz', '.7z', '.rar', '.jar', '.whl',
  '.exe', '.dll', '.so', '.dylib', '.bin', '.dat', '.class', '.o', '.a', '.lib',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.odt', '.ods',
  '.pyc', '.pyo', '.map', '.lock', '.min.js', '.min.css', '.db', '.sqlite',
])

/** Name shapes that must never be shipped to a model provider. */
const SECRET_NAME_RE = /(^|\/)(\.env(\..*)?|.*\.(key|pem|pfx|p12|jks|keystore|ppk)|credentials?.*|.*credential.*|secrets?.*|.*secret.*|.*password.*|.*passwd.*|id_rsa.*|id_ed25519.*|id_ecdsa.*|\.npmrc|\.netrc|\.git-credentials)$/i

/** Manifest and configuration files worth reading before anything else. */
const MANIFEST_NAMES = new Set([
  'package.json', 'pyproject.toml', 'cargo.toml', 'go.mod', 'gemfile', 'pom.xml',
  'build.gradle', 'requirements.txt', 'tsconfig.json', 'jsconfig.json',
  'vite.config.ts', 'vite.config.js', 'webpack.config.js', 'rollup.config.js',
  'next.config.js', 'nuxt.config.ts', 'dockerfile', 'docker-compose.yml',
  'compose.yaml', 'makefile', 'justfile', 'cargo.lock', '.editorconfig',
])

/** Source/text extensions whose excerpt is worth spending budget on. */
const TEXT_EXT_RE = /\.(md|markdown|txt|rst|ts|tsx|mts|cts|js|jsx|mjs|cjs|vue|svelte|py|rs|go|java|kt|kts|cs|c|h|cpp|hpp|cc|swift|rb|php|lua|sh|bash|zsh|ps1|psm1|bat|cmd|sql|json|json5|jsonc|ya?ml|toml|ini|cfg|conf|env\.example|html|htm|css|scss|sass|less)$/i

/** Hard cap on directory entries VISITED, so a pathological tree cannot stall. */
const VISIT_CAP = 4000

/** Marker appended to an excerpt cut to fit the budget. */
const TRUNCATION_MARK = '\n…（已截断）'

/**
 * Neutralize the framing tags inside untrusted file text so a file can never
 * close (or forge) the `<workspace_context>` / `<conversation_context>` blocks
 * around itself. Mirrors the escaping in `context.ts` and `prompts.ts`.
 * @param text - one excerpt.
 * @returns the excerpt with any framing tag defused.
 */
function neutralize(text: string): string {
  return text.replace(/<\/?(workspace_context|conversation_context)>/gi, '<\\/$1>')
}

/** Lowercase extension including the dot, or the empty string. */
function extOf(name: string): string {
  const index = name.lastIndexOf('.')
  return index <= 0 ? '' : name.slice(index).toLowerCase()
}

/**
 * Read priority of one file: lower reads first. README-style files name the
 * project, manifests fix the stack, docs and source carry the wording and
 * conventions the rewrite should mirror.
 * @param name - the file's basename.
 * @returns 0 (readme) through 4 (unranked text file).
 */
function rankOf(name: string): number {
  if (/^readme(\..*)?$/i.test(name)) return 0
  if (/^(license|copying|changelog|contributing)(\..*)?$/i.test(name)) return 2
  if (MANIFEST_NAMES.has(name.toLowerCase())) return 1
  if (/\.(md|markdown|txt|rst)$/i.test(name)) return 2
  if (TEXT_EXT_RE.test(name)) return 3
  return 4
}

/**
 * Scan one working directory into a bounded workspace snippet.
 *
 * Files are ranked (readme → manifest → docs → source → other), then shallower
 * paths first, and read until the file-count or character budget is reached.
 * Anything unreadable, non-text, secret-shaped, or over budget is skipped
 * without failing the scan.
 * @param fs - the `ctx.fs` service (or a structural stub).
 * @param cwd - the absolute working directory to scan.
 * @param options - the configured bounds.
 * @param signal - caller cancellation, checked between entries.
 * @returns the scan, or `undefined` when the root cannot be resolved/listed.
 */
export async function scanWorkspace(
  fs: FsFace,
  cwd: string,
  options: WorkspaceOptions,
  signal?: AbortSignal,
): Promise<WorkspaceScan | undefined> {
  if (cwd.trim() === '') return undefined
  const maxDepth = Math.max(1, options.maxDepth)
  const treeMax = Math.max(0, options.treeMax)
  let root: FsTargetLike
  try {
    root = await fs.resolve(cwd, signal === undefined ? undefined : { signal })
  } catch {
    return undefined
  }
  const tree: string[] = []
  const candidates: Array<{ path: string; depth: number; target: FsTargetLike; rank: number }> = []
  const queue: Array<{ target: FsTargetLike; prefix: string; depth: number }> = [{ target: root, prefix: '', depth: 0 }]
  let visited = 0
  let truncated = treeMax === 0
  while (queue.length > 0) {
    const node = queue.shift()!
    let entries: readonly FsEntryLike[]
    try {
      entries = await fs.listDir(node.target, signal)
    } catch {
      continue
    }
    const sorted = [...entries].sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of sorted) {
      if (signal?.aborted) return undefined
      if (visited++ >= VISIT_CAP) {
        truncated = true
        break
      }
      const name = entry.name
      const path = node.prefix === '' ? name : `${node.prefix}/${name}`
      if (entry.type === 'directory') {
        if (SKIP_DIRS.has(name.toLowerCase())) continue
        if (tree.length < treeMax) tree.push(`${path}/`)
        else truncated = true
        if (node.depth + 1 < maxDepth) queue.push({ target: entry.target, prefix: path, depth: node.depth + 1 })
        continue
      }
      const lower = name.toLowerCase()
      if (SKIP_EXT.has(extOf(lower))) continue
      if (SECRET_NAME_RE.test(path)) continue
      if (tree.length < treeMax) tree.push(path)
      else truncated = true
      candidates.push({ path, depth: node.depth, target: entry.target, rank: rankOf(name) })
    }
  }
  // Shallower paths before deeper ones at equal rank: the near-root files are
  // the ones a reader of the draft is most likely to mean.
  candidates.sort((a, b) => (a.rank - b.rank) || (a.depth - b.depth) || a.path.localeCompare(b.path))
  const files: WorkspaceFile[] = []
  let used = 0
  for (const candidate of candidates) {
    if (signal?.aborted) return undefined
    if (files.length >= options.maxFiles || used >= options.maxChars) {
      truncated = true
      break
    }
    let text: unknown
    try {
      text = await fs.readText(candidate.target, signal)
    } catch {
      continue
    }
    if (typeof text !== 'string' || text === '') continue
    // A NUL byte is the one cheap signal that this is not the UTF-8 text the
    // service promises; skipping beats shipping mojibake to the model.
    if (text.includes('\u0000')) continue
    const budget = Math.max(0, Math.min(options.maxFileChars, options.maxChars - used))
    if (budget === 0) {
      truncated = true
      break
    }
    const cut = text.length > budget
    if (cut) truncated = true
    const snippet = cut
      ? `${text.slice(0, Math.max(0, budget - TRUNCATION_MARK.length))}${TRUNCATION_MARK}`
      : text
    files.push({ path: candidate.path, snippet: neutralize(snippet) })
    used += snippet.length
  }
  return { root: root.displayPath, tree, files, truncated }
}

/**
 * Render one scan into the framed block handed to the model.
 * @param scan - the assembled scan.
 * @param options - the same bounds the scan ran under (quoted in the header).
 * @returns the `<workspace_context>` block.
 */
export function formatWorkspaceBlock(scan: WorkspaceScan, options: WorkspaceOptions): string {
  const lines: string[] = []
  lines.push(`工作区：${scan.root}`)
  lines.push(`扫描范围：目录深度 ≤${Math.max(1, options.maxDepth)}，最多列出 ${options.treeMax} 个条目、${options.maxFiles} 个文件内容（每个 ≤${options.maxFileChars} 字，合计 ≤${options.maxChars} 字）`)
  if (scan.tree.length > 0) {
    lines.push('', '目录结构：', ...scan.tree)
  }
  if (scan.files.length > 0) {
    lines.push('', '关键文件内容：')
    for (const file of scan.files) {
      lines.push(`--- ${file.path} ---`, file.snippet)
    }
  }
  if (scan.truncated) {
    lines.push('', '（以上为节选：该工作区还有未列出的文件与目录）')
  }
  return `<workspace_context>\n${lines.join('\n')}\n</workspace_context>`
}

/** Opening marker used by callers to detect a workspace layer in a prebuilt block. */
export const WORKSPACE_BLOCK_OPEN = '<workspace_context>'

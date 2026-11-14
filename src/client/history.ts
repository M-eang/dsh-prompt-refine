/**
 * Per-session enhancement history: the rewrites this composer produced, newest
 * first, so a user can bring back a result that the undo bar no longer holds
 * (it only ever keeps the most recent apply, and it is dismissed on the next
 * one).
 *
 * Pure factory — the client half owns one module-level instance, tests own
 * theirs. Entries are capped per session and sessions are capped globally with
 * the same least-recently-written eviction the undo stack uses, so a long-lived
 * page with many composers cannot accumulate text without bound. Only what the
 * user already saw in the panel is kept; nothing here is sent anywhere.
 * @module dsh-prompt-refine/client/history
 */

/** One settled enhancement, as the panel saw it. */
export interface EnhanceHistoryEntry {
  /** Monotonic id, unique inside one store (React key + apply target). */
  readonly id: number
  /** Creation time in ms, for the relative label. */
  readonly at: number
  /** The draft that was rewritten. */
  readonly original: string
  /** The rewrite the call settled on. */
  readonly result: string
  /** The mode that produced it; absent for the default `standard`. */
  readonly mode?: string
  /** The template that produced it; absent when none applied. */
  readonly template?: string
}

/** What a caller supplies when recording; the store stamps `id` and `at`. */
export interface EnhanceHistoryInput {
  original: string
  result: string
  mode?: string
  template?: string
}

/** The store the client half owns (one per page). */
export interface EnhanceHistoryStore {
  /** Record one settled rewrite, dropping the oldest entry of that session. */
  record(sessionId: string, input: EnhanceHistoryInput): EnhanceHistoryEntry
  /** Newest-first entries of one session (empty array when none). */
  list(sessionId: string): readonly EnhanceHistoryEntry[]
  /** Forget one session's entries (the panel's "clear history"). */
  clear(sessionId: string): void
}

/**
 * Create a history store.
 * @param maxPerSession - entries kept per session (default 10).
 * @param maxSessions - sessions kept, least-recently-written first (default
 *   40); the session count is unbounded otherwise, and each holds text.
 * @returns the store.
 */
export function createHistoryStore(maxPerSession = 10, maxSessions = 40): EnhanceHistoryStore {
  const sessions = new Map<string, EnhanceHistoryEntry[]>()
  let seq = 0
  return {
    record(sessionId, input) {
      const entry: EnhanceHistoryEntry = {
        id: ++seq,
        at: Date.now(),
        original: input.original,
        result: input.result,
        ...(input.mode === undefined ? {} : { mode: input.mode }),
        ...(input.template === undefined ? {} : { template: input.template }),
      }
      const entries = sessions.get(sessionId) ?? []
      entries.unshift(entry)
      while (entries.length > maxPerSession) entries.pop()
      // Refresh this session's recency: Map iteration order is insertion order,
      // and the eviction below keys on it (least-recently written first).
      sessions.delete(sessionId)
      sessions.set(sessionId, entries)
      while (sessions.size > maxSessions) {
        const oldest = sessions.keys().next().value
        if (oldest === undefined) break
        sessions.delete(oldest)
      }
      return entry
    },
    list(sessionId) {
      return sessions.get(sessionId) ?? []
    },
    clear(sessionId) {
      sessions.delete(sessionId)
    },
  }
}

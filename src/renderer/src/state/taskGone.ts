/** Hermes says the task isn't there (any more): a 404 status, not a message that happens to say "not found". */
export function taskGone(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === 404
}

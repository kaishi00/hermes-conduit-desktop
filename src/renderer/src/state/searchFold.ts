/**
 * How a search compares words: without case and without accents, so
 * `andre` finds `André` and `André` finds `Andre` (desktop#399; the
 * phone's Chats search folds the same way).
 */
export function searchFold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase()
}

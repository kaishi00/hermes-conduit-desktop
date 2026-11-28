/**
 * Control from Hermes' allow list is kept per dashboard (desktop issue 729):
 * each entry is a dashboard's address and a bot's profile, so a bot with the
 * same name on another Hermes is a different bot, which asks nothing until
 * it's ticked on that dashboard.
 */

/** A bot on a dashboard, as the allow list keeps it. */
export const pcAllowKey = (host: string, profile: string): string => `${host}\n${profile}`

/** Whether the allow list lets this dashboard's bot ask. */
export const pcAllowed = (bots: readonly string[], host: string, profile: string): boolean => !!host && bots.includes(pcAllowKey(host, profile))

/**
 * A list saved before it was kept per dashboard holds bare profiles: each
 * goes to the dashboard showing when it's first read (the one it was ticked
 * on, for nearly everyone), and the ask names that dashboard from then on.
 */
export const adoptBareBots = (bots: readonly string[], host: string): string[] =>
  host ? [...new Set(bots.map(bot => (bot.includes('\n') ? bot : pcAllowKey(host, bot))))] : [...bots]

export const hasBareBots = (bots: readonly string[]): boolean => bots.some(bot => !bot.includes('\n'))

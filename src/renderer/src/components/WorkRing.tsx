/**
 * A bot at work, drawn on its face (Eric, 2026-11-26): a thin arc circling it while it works, and a
 * steady amber ring with the count when something needs you, which pulses once as it appears. The
 * words stay in the row's tooltip and label; this is only the mark. Its parent is position: relative.
 */
export function WorkRing({ needs }: { needs: number }) {
  return (
    <span className={`work-ring ${needs > 0 ? 'needs' : 'working'}`} aria-hidden="true">
      {needs > 0 ? <b className="work-ring-count">{needs}</b> : null}
    </span>
  )
}

/** When Settings listens for Quick Ask's keys, the Mac menu must stay aside (issue 616). */
export function rebuildMenu(isMac: boolean, recording: boolean): boolean {
  return isMac && !recording
}

export function shouldSkipFrameForExchange(
  frameExchange: string | undefined,
  activeExchange: string | undefined
): boolean {
  if (frameExchange && activeExchange && frameExchange !== activeExchange) {
    return true
  }
  return false
}

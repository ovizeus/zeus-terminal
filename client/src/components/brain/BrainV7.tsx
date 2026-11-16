// ZeuS Brain v7 — locul in care se monteaza creierul (client/src/brain/brainUI.ts).
// Coaja React statica: creierul isi construieste singur DOM-ul si isi tine bucla;
// React doar il porneste la montare si il opreste la demontare.
import { useEffect, useRef } from 'react'
import { startBrain } from '../../brain/brainUI'

export function BrainV7() {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let stop: (() => void) | null = null
    try { stop = startBrain(el) } catch (e) { console.warn('[brain v7] start failed:', (e as Error)?.message || e) }
    return () => { try { stop && stop() } catch { /* deja oprit */ } }
  }, [])
  return <div ref={ref} id="zeusBrainV7" />
}

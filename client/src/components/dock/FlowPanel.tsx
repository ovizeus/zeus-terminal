import { OrderFlowPanel } from '../advanced/OrderFlowPanel'

/** Flow dock page view — 1:1 from #flow-panel in index.html lines 949-970
 *  Original body (#flow-panel-body) is empty; populated by of-hud from orderflow.js.
 *  React equivalent: OrderFlowPanel renders the HUD content. */
export function FlowPanel() {
  return (
    <div id="flow-panel-body">
      <OrderFlowPanel />
    </div>
  )
}

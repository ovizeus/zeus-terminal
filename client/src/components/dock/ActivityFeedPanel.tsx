/** Activity Feed dock page view — 1:1 from #actfeed-panel in index.html lines 813-815
 *  List populated by _actfeedRender() in bootstrap.js */
export function ActivityFeedPanel() {
  return (
    <div id="actfeed-panel">
      <div id="actfeedList" className="actfeed-list">
        <div className="actfeed-empty">No activity yet — events will appear here as the system operates.</div>
      </div>
    </div>
  );
}

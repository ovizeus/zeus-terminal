import { TeacherPanel } from '../advanced/TeacherPanel'

/** Teacher dock page view — wraps existing TeacherPanel (1:1 from #teacher-strip-panel) */
export function TeacherDockPanel() {
  return (
    <div id="teacher-strip-panel">
      <div id="teacher-panel-content">
        <TeacherPanel />
      </div>
    </div>
  )
}

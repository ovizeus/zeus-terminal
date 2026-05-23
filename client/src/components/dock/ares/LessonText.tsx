import { memo } from 'react'
import { useAresStore } from '../../../stores/aresStore'

/* [R28.2-G] Lesson text line. Replaces imperative
 * `lessonEl.textContent = lastLesson + '  |  ' + patternInsight`.
 */
export const LessonText = memo(function LessonText() {
  const lesson = useAresStore((s) => s.ui.lesson)
  const text = lesson.trim().length > 0 && lesson !== '|'
    ? lesson
    : 'Awaiting first trade analysis...'
  return <div id="ares-lesson-text">{text}</div>
})

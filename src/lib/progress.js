/**
 * =====================================================================
 * Lesson progress tracking (Lessons page)
 * ---------------------------------------------------------------------
 * Content delivery only — this module knows nothing about homework.
 * Progress is stored per student in localStorage so it survives reloads
 * without requiring an extra database table:
 *
 *   physics_hub_lesson_progress_<studentId> = {
 *     "<lessonId>": { watchedAt: ISO, completed: true, completedAt: ISO }
 *   }
 * =====================================================================
 */

const keyFor = (studentId) => `physics_hub_lesson_progress_${studentId || 'guest'}`

function readAll(studentId) {
  try {
    return JSON.parse(localStorage.getItem(keyFor(studentId)) || '{}')
  } catch (_) {
    return {}
  }
}

function writeAll(studentId, data) {
  try {
    localStorage.setItem(keyFor(studentId), JSON.stringify(data))
  } catch (_) {}
  // Let other components on the page react instantly
  try {
    window.dispatchEvent(new CustomEvent('lesson-progress-changed', { detail: { studentId } }))
  } catch (_) {}
  return data
}

/** Full progress map for a student. */
export function getLessonProgress(studentId) {
  return readAll(studentId)
}

export function isLessonCompleted(studentId, lessonId) {
  return Boolean(readAll(studentId)[String(lessonId)]?.completed)
}

/** Record that the student opened / watched a lesson. */
export function markLessonWatched(studentId, lessonId) {
  const all = readAll(studentId)
  const id = String(lessonId)
  all[id] = { ...(all[id] || {}), watchedAt: new Date().toISOString() }
  return writeAll(studentId, all)
}

/** Toggle / set the "completed" flag for a lesson. */
export function setLessonCompleted(studentId, lessonId, completed = true) {
  const all = readAll(studentId)
  const id = String(lessonId)
  all[id] = {
    ...(all[id] || {}),
    completed,
    completedAt: completed ? new Date().toISOString() : null,
    watchedAt: all[id]?.watchedAt || new Date().toISOString(),
  }
  return writeAll(studentId, all)
}

export function toggleLessonCompleted(studentId, lessonId) {
  return setLessonCompleted(studentId, lessonId, !isLessonCompleted(studentId, lessonId))
}

/**
 * Course-module statistics for a list of lessons.
 * @returns {{ total:number, completed:number, watched:number, percent:number }}
 */
export function summarizeProgress(studentId, lessons = []) {
  const all = readAll(studentId)
  const total = lessons.length
  let completed = 0
  let watched = 0
  lessons.forEach((l) => {
    const st = all[String(l.id)]
    if (!st) return
    if (st.completed) completed += 1
    else if (st.watchedAt) watched += 1
  })
  return {
    total,
    completed,
    watched,
    percent: total ? Math.round((completed / total) * 100) : 0,
  }
}

/** Group lessons into course modules (unit) with their own progress. */
export function summarizeByUnit(studentId, lessons = []) {
  const all = readAll(studentId)
  const units = new Map()
  lessons.forEach((l) => {
    const unit = l.unit || l.branch || '—'
    if (!units.has(unit)) units.set(unit, { unit, lessons: [], completed: 0 })
    const bucket = units.get(unit)
    bucket.lessons.push(l)
    if (all[String(l.id)]?.completed) bucket.completed += 1
  })
  return [...units.values()].map((u) => ({
    ...u,
    total: u.lessons.length,
    percent: u.lessons.length ? Math.round((u.completed / u.lessons.length) * 100) : 0,
  }))
}

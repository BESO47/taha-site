/**
 * =====================================================================
 * Physics Hub — Answer-key based grading engine
 * ---------------------------------------------------------------------
 * A single, dependency-free module that marks a student submission by
 * COMPARING EVERY ANSWER AGAINST THE CORRECT ANSWER KEY.
 *
 * It is used by:
 *   - lib/api.js                     -> lesson homework auto marking
 *   - components/HomeworkSubmitCard  -> instant student feedback
 *   - components/admin/HomeworkTab   -> teacher marking screen / re-grade
 *   - homework-grading.sql           -> the SQL RPC mirrors the same rules
 *
 * Grades are NEVER derived from "did the student submit?" or from the
 * number of submissions. The final score / percentage always comes from
 * how many answers match the key, weighted by each question's points.
 * =====================================================================
 */

export const OPTION_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F']

/** Arabic option letters used by some legacy answer keys. */
const ARABIC_LETTER_MAP = { 'أ': 'A', 'ا': 'A', 'ب': 'B', 'ج': 'C', 'د': 'D', 'هـ': 'E', 'ه': 'E' }

/** Arabic-Indic digits -> latin digits. */
const ARABIC_DIGITS = { '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9' }

/**
 * Aggressive text normalizer used for the "free text" comparison branch:
 * trims, lower-cases, unifies Arabic characters/digits, drops diacritics,
 * punctuation and repeated whitespace so that "٥ أمبير" === "5 امبير".
 */
export function normalizeText(value) {
  if (value === null || value === undefined) return ''
  return String(value)
    .replace(/[٠-٩]/g, (d) => ARABIC_DIGITS[d] || d)
    .replace(/[\u064B-\u0652\u0640]/g, '')      // harakat + tatweel
    .replace(/[إأآا]/g, 'ا')
    .replace(/[ىي]/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')            // punctuation -> space
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

/** Strip a leading "A) " / "A." / "1-" prefix from an option label. */
function stripOptionPrefix(label) {
  return String(label ?? '').replace(/^\s*(?:[A-Fa-f]|[أ-ي]|\d{1,2})\s*[).:\-–]\s*/, '').trim()
}

/**
 * Resolve any raw answer representation into a canonical option letter.
 * Accepts: "A", "a", "A) Ampere", "Ampere", 0, "1", "أ", { letter: 'A' }.
 * Returns '' when the value cannot be mapped onto an option.
 */
export function toOptionLetter(raw, options = []) {
  if (raw === null || raw === undefined || raw === '') return ''

  let value = raw
  if (typeof value === 'object') {
    value = value.letter ?? value.answer ?? value.value ?? value.choice ?? value.text ?? ''
  }
  const str = String(value).trim()
  if (!str) return ''

  // 1. Plain latin letter  ("A", "b)")
  const letterMatch = str.match(/^([A-Fa-f])\s*[).:\-–]?\s*$/)
  if (letterMatch) return letterMatch[1].toUpperCase()

  // 2. Arabic letter ("أ")
  const arabic = ARABIC_LETTER_MAP[str.replace(/[).:\-–\s]/g, '')]
  if (arabic) return arabic

  // 3. Numeric index — 1-based ("1" -> A) or 0-based when the key is 0
  const numeric = normalizeText(str)
  if (/^\d{1,2}$/.test(numeric)) {
    const n = Number(numeric)
    if (n === 0) return OPTION_LETTERS[0]
    if (n >= 1 && n <= OPTION_LETTERS.length) return OPTION_LETTERS[n - 1]
  }

  // 4. Prefixed option label ("A) Ampere")
  const prefixed = str.match(/^\s*([A-Fa-f]|[أ-ي])\s*[).:\-–]\s*/)
  if (prefixed) {
    const l = prefixed[1].toUpperCase()
    return ARABIC_LETTER_MAP[prefixed[1]] || (/^[A-F]$/.test(l) ? l : '')
  }

  // 5. Full option text — match against the option list
  const target = normalizeText(stripOptionPrefix(str))
  if (target && Array.isArray(options)) {
    for (let i = 0; i < options.length; i++) {
      const opt = options[i]
      const optText = normalizeText(stripOptionPrefix(typeof opt === 'object' ? opt?.text ?? opt?.label ?? '' : opt))
      if (optText && optText === target) return OPTION_LETTERS[i] || ''
    }
  }

  return ''
}

/**
 * Normalize one question definition into the canonical shape used by the
 * marker. Supports every historical field name used in this codebase:
 *   answer | correctAnswer | correct | correct_answer | key | modelAnswer
 */
export function normalizeQuestion(question, index = 0) {
  const q = question || {}
  const id = String(q.id ?? q.questionId ?? q.key ?? index + 1)
  const options = Array.isArray(q.options) ? q.options : []
  const rawKey =
    q.answer ?? q.correctAnswer ?? q.correct ?? q.correct_answer ?? q.key ?? q.modelAnswer ?? ''
  const points = Number(q.points ?? q.mark ?? q.score ?? 1)

  return {
    id,
    index,
    number: index + 1,
    question: q.question ?? q.text ?? q.title ?? '',
    options,
    type: q.type || (options.length ? 'mcq' : 'text'),
    rawKey,
    correctLetter: toOptionLetter(rawKey, options),
    correctText: stripOptionPrefix(rawKey),
    points: Number.isFinite(points) && points > 0 ? points : 1,
  }
}

/**
 * Build the answer key from either
 *   - an array of question objects (`assignments.questions`, `homeworkQuestions`), or
 *   - a `{ questionId: 'A' }` map (`lessons.model_answers`).
 * When both are supplied the map overrides / fills the per-question key,
 * which is exactly how the legacy "model answers" editor behaves.
 */
export function buildAnswerKey(questions = [], modelAnswers = null) {
  const list = (Array.isArray(questions) ? questions : []).map(normalizeQuestion)

  // Model answers supplied as an array of question objects
  if (Array.isArray(modelAnswers) && modelAnswers.length) {
    const byId = new Map(modelAnswers.map((m, i) => [String(m?.id ?? i + 1), m]))
    list.forEach((q) => {
      const m = byId.get(q.id) || byId.get(String(q.number))
      if (!m) return
      const raw = m.answer ?? m.correctAnswer ?? m.correct ?? ''
      if (raw !== '' && raw !== null && raw !== undefined) {
        q.rawKey = raw
        q.correctLetter = toOptionLetter(raw, q.options)
        q.correctText = stripOptionPrefix(raw)
      }
    })
    if (list.length) return list
    return modelAnswers.map((m, i) => normalizeQuestion(m, i))
  }

  // Model answers supplied as a { key: letter } map
  if (modelAnswers && typeof modelAnswers === 'object') {
    const entries = Object.entries(modelAnswers).filter(([, v]) => v !== null && v !== undefined && v !== '')

    if (list.length) {
      const map = new Map(entries.map(([k, v]) => [String(k).trim(), v]))
      list.forEach((q) => {
        const raw = map.get(q.id) ?? map.get(String(q.number))
        if (raw !== undefined) {
          q.rawKey = raw
          q.correctLetter = toOptionLetter(raw, q.options)
          q.correctText = stripOptionPrefix(raw)
        }
      })
      return list
    }

    // No question definitions at all — synthesise them from the key map
    return entries.map(([k, v], i) =>
      normalizeQuestion({ id: k, question: '', options: [], answer: v, points: 1 }, i)
    )
  }

  return list
}

/** True when a question actually has a usable correct answer. */
export function hasKey(question) {
  return Boolean(question.correctLetter || normalizeText(question.correctText))
}

/**
 * Compare ONE student answer with the key.
 * MCQ questions are compared letter-to-letter; text questions fall back to
 * the normalized-text comparison so numeric / short answers still work.
 */
export function isAnswerCorrect(question, studentRaw) {
  if (studentRaw === null || studentRaw === undefined || String(studentRaw).trim() === '') return false

  const studentLetter = toOptionLetter(studentRaw, question.options)
  if (question.correctLetter) {
    if (studentLetter) return studentLetter === question.correctLetter
    // Student sent free text for an MCQ: compare with the correct option text
    const correctOption = question.options?.[OPTION_LETTERS.indexOf(question.correctLetter)]
    const correctText = normalizeText(stripOptionPrefix(correctOption ?? question.correctText))
    return Boolean(correctText) && normalizeText(stripOptionPrefix(studentRaw)) === correctText
  }

  const expected = normalizeText(stripOptionPrefix(question.correctText))
  if (!expected) return false
  return normalizeText(stripOptionPrefix(studentRaw)) === expected
}

/** Read the student's answer for a question from an answers map/array. */
export function pickStudentAnswer(answers, question) {
  if (!answers) return undefined
  if (Array.isArray(answers)) {
    const hit = answers.find(
      (a) => String(a?.questionId ?? a?.id ?? '') === question.id || Number(a?.index) === question.index
    )
    if (hit) return hit.answer ?? hit.value ?? hit.choice ?? hit.letter
    return answers[question.index]
  }
  if (typeof answers !== 'object') return undefined
  return (
    answers[question.id] ??
    answers[String(question.number)] ??
    answers[question.number] ??
    answers[`q${question.number}`] ??
    answers[`Q${question.number}`] ??
    answers[question.index]
  )
}

/**
 * ============================ THE MARKER =============================
 * Grade a whole submission against the answer key.
 *
 * @param {object}  input
 * @param {Array}   input.questions     question definitions (with `answer`)
 * @param {object}  input.modelAnswers  optional `{ id: 'A' }` key override
 * @param {object}  input.answers       the student's answers
 * @param {boolean} input.countUnansweredAsIncorrect  default true
 *
 * @returns {{
 *   totalQuestions:number, gradedQuestions:number, answeredCount:number,
 *   unansweredCount:number, correctCount:number, incorrectCount:number,
 *   earnedPoints:number, totalPoints:number, score:number, percentage:number,
 *   hasAnswerKey:boolean, breakdown:Array
 * }}
 */
export function gradeSubmissionAgainstKey({
  questions = [],
  modelAnswers = null,
  answers = {},
  countUnansweredAsIncorrect = true,
} = {}) {
  const key = buildAnswerKey(questions, modelAnswers)

  let correctCount = 0
  let incorrectCount = 0
  let unansweredCount = 0
  let earnedPoints = 0
  let totalPoints = 0
  let gradedQuestions = 0

  const breakdown = key.map((q) => {
    const studentRaw = pickStudentAnswer(answers, q)
    const answered = studentRaw !== undefined && studentRaw !== null && String(studentRaw).trim() !== ''
    const keyed = hasKey(q)
    const correct = keyed && answered ? isAnswerCorrect(q, studentRaw) : false

    if (keyed) {
      gradedQuestions += 1
      totalPoints += q.points
      if (correct) {
        correctCount += 1
        earnedPoints += q.points
      } else if (!answered) {
        unansweredCount += 1
        if (countUnansweredAsIncorrect) incorrectCount += 1
      } else {
        incorrectCount += 1
      }
    } else if (!answered) {
      unansweredCount += 1
    }

    const studentLetter = toOptionLetter(studentRaw, q.options)
    return {
      questionId: q.id,
      number: q.number,
      question: q.question,
      options: q.options,
      points: q.points,
      hasKey: keyed,
      answered,
      studentAnswer: answered ? String(studentRaw) : '',
      studentLetter,
      correctAnswer: q.correctLetter || q.correctText || '',
      correctLetter: q.correctLetter,
      isCorrect: correct,
      earnedPoints: correct ? q.points : 0,
    }
  })

  const roundedEarned = Math.round(earnedPoints * 100) / 100
  const roundedTotal = Math.round(totalPoints * 100) / 100
  const percentage = roundedTotal > 0 ? Math.round((roundedEarned / roundedTotal) * 100) : 0

  return {
    totalQuestions: key.length,
    gradedQuestions,
    answeredCount: breakdown.filter((b) => b.answered).length,
    unansweredCount,
    correctCount,
    incorrectCount,
    earnedPoints: roundedEarned,
    totalPoints: roundedTotal,
    score: roundedEarned,
    maxScore: roundedTotal,
    percentage,
    hasAnswerKey: gradedQuestions > 0,
    breakdown,
  }
}

/** Short label helper: "7 / 10 (70%)". */
/**
 * Roll a list of graded submissions up into class-level statistics.
 * Averages are computed from CORRECTNESS percentages, never from the
 * number of submissions received.
 */
export function summarizeGrades(results = []) {
  const graded = results.filter((r) => r && Number.isFinite(Number(r.percentage)))
  if (!graded.length) {
    return { count: 0, averagePercent: 0, totalCorrect: 0, totalIncorrect: 0, highest: 0, lowest: 0 }
  }
  const percents = graded.map((r) => Number(r.percentage))
  return {
    count: graded.length,
    averagePercent: Math.round(percents.reduce((a, b) => a + b, 0) / graded.length),
    totalCorrect: graded.reduce((a, r) => a + (Number(r.correctCount) || 0), 0),
    totalIncorrect: graded.reduce((a, r) => a + (Number(r.incorrectCount) || 0), 0),
    highest: Math.max(...percents),
    lowest: Math.min(...percents),
  }
}

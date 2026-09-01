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

/**
 * =====================================================================
 * SUBPOINT NUMBERING — lowercase roman numerals (i, ii, iii, iv, …)
 * ---------------------------------------------------------------------
 * Subpoints are numbered automatically from their ORDER in the question,
 * never from a stored label. Deleting subpoint ii therefore re-numbers
 * the remaining ones (i, ii, iii) with no data migration, in the admin
 * editor, on the student paper, in the marking screen and in the results.
 *
 * The label is generated, so it is always rendered inside a `dir="ltr"`
 * span: an RTL paragraph would otherwise visually reorder "ii" -> "ii"
 * with the following punctuation and corrupt multi-character numerals.
 * =====================================================================
 */
const ROMAN_STEPS = [
  [1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'],
  [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'],
  [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i'],
]

/**
 * 1-based ordinal -> lowercase roman numeral ("i", "ii", "iii", …).
 * Falls back to the plain number outside the representable range so the
 * UI can never render an empty label.
 */
export function romanNumeral(ordinal) {
  const n = Math.trunc(Number(ordinal))
  if (!Number.isFinite(n) || n < 1) return ''
  if (n > 3999) return String(n)
  let rest = n
  let out = ''
  for (const [value, glyph] of ROMAN_STEPS) {
    while (rest >= value) {
      out += glyph
      rest -= value
    }
  }
  return out
}

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
 * Normalize ONE nested subpoint into the same canonical shape the marker
 * uses for a whole question. A subpoint is a complete MCQ of its own:
 * it has its text, four options, one correct answer and its own points.
 *
 * `sp.text` is the historical field name used by the editor; `question`
 * is the canonical one. Both are accepted so previously stored homework
 * keeps working.
 */
export function normalizeSubpoint(subpoint, index = 0, parentId = '') {
  const s = subpoint || {}
  const id = String(s.id ?? s.subpointId ?? s.key ?? `${parentId || 'q'}_${index + 1}`)
  const options = Array.isArray(s.options) ? s.options : []
  const rawKey = s.answer ?? s.correctAnswer ?? s.correct ?? s.correct_answer ?? ''
  const points = Number(s.points ?? s.mark ?? s.score ?? 1)

  return {
    id,
    index,
    /** 1-based position inside the parent question. */
    number: index + 1,
    /** Generated display label — never stored, never editable. */
    label: romanNumeral(index + 1),
    question: s.question ?? s.text ?? s.title ?? '',
    options,
    type: s.type || (options.length ? 'mcq' : 'text'),
    rawKey,
    correctLetter: toOptionLetter(rawKey, options),
    correctText: stripOptionPrefix(rawKey),
    points: Number.isFinite(points) && points > 0 ? points : 1,
  }
}

/**
 * Normalize one question definition into the canonical shape used by the
 * marker. Supports every historical field name used in this codebase:
 *   answer | correctAnswer | correct | correct_answer | key | modelAnswer
 *
 * Optional nested `subpoints` are normalized too; their roman-numeral
 * labels are derived from the array order on every read.
 */
export function normalizeQuestion(question, index = 0) {
  const q = question || {}
  const id = String(q.id ?? q.questionId ?? q.key ?? index + 1)
  const options = Array.isArray(q.options) ? q.options : []
  const rawKey =
    q.answer ?? q.correctAnswer ?? q.correct ?? q.correct_answer ?? q.key ?? q.modelAnswer ?? ''
  const points = Number(q.points ?? q.mark ?? q.score ?? 1)
  const subpoints = Array.isArray(q.subpoints)
    ? q.subpoints.filter(Boolean).map((sp, i) => normalizeSubpoint(sp, i, id))
    : []

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
    subpoints,
    hasSubpoints: subpoints.length > 0,
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
        // A key may also target a subpoint directly (keyed by subpoint id).
        q.subpoints.forEach((sp) => {
          const spRaw = map.get(sp.id)
          if (spRaw !== undefined) {
            sp.rawKey = spRaw
            sp.correctLetter = toOptionLetter(spRaw, sp.options)
            sp.correctText = stripOptionPrefix(spRaw)
          }
        })
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

/**
 * Read the RAW node stored for a question out of an answers map/array.
 *
 * Two shapes are supported, and both may coexist inside one submission:
 *   1. flat    — `{ "q1": "B" }`                       (original format)
 *   2. nested  — `{ "q1": { answer: "B",
 *                             subpoints: { "sp_1": "C", "sp_2": "A" } } }`
 *
 * Nothing is migrated: a paper saved before nested subpoints existed keeps
 * reading exactly as it did.
 */
function pickAnswerNode(answers, question) {
  if (!answers) return undefined
  if (Array.isArray(answers)) {
    const hit = answers.find(
      (a) => String(a?.questionId ?? a?.id ?? '') === question.id || Number(a?.index) === question.index
    )
    if (hit) return hit
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
 * Read the student's answer for a question from an answers map/array.
 * For a nested node this is the PARENT answer only — subpoints are read
 * with `pickSubpointAnswer` so one answer can never stand in for a whole
 * group of them.
 */
export function pickStudentAnswer(answers, question) {
  const node = pickAnswerNode(answers, question)
  if (node === undefined || node === null) return undefined
  if (Array.isArray(answers)) {
    if (typeof node === 'object') return node.answer ?? node.value ?? node.choice ?? node.letter
    return node
  }
  if (typeof node === 'object') {
    return node.answer ?? node.value ?? node.choice ?? node.letter ?? ''
  }
  return node
}

/**
 * Read ONE subpoint's answer.
 *
 * Looks the answer up by the subpoint's STABLE ID first — never by array
 * index alone — so deleting or re-ordering subpoints in the editor cannot
 * silently re-map a student's answers onto different questions.
 */
export function pickSubpointAnswer(answers, question, subpoint) {
  const node = pickAnswerNode(answers, question)

  if (node && typeof node === 'object' && !Array.isArray(node)) {
    const bag = node.subpoints ?? node.subpointsAnswers ?? node.sub ?? node.items
    if (bag && typeof bag === 'object' && !Array.isArray(bag)) {
      const hit = bag[subpoint.id] ?? bag[String(subpoint.number)] ?? bag[subpoint.label]
      if (hit !== undefined && hit !== null) return hit
    }
  }

  // Legacy flat keys written before the nested format: "q1.sp_1", "q1.0", "q1.i"
  if (answers && typeof answers === 'object' && !Array.isArray(answers)) {
    const legacy = [
      `${question.id}.${subpoint.id}`,
      `${question.id}.${subpoint.index}`,
      `${question.id}.${subpoint.label}`,
      `${question.number}.${subpoint.id}`,
    ]
    for (const key of legacy) {
      if (answers[key] !== undefined && answers[key] !== null) return answers[key]
    }
  }

  return undefined
}

/**
 * Write ONE answer back into an answers map, preserving every other
 * answer untouched. Used by the admin "edit answer" preview so the UI and
 * the marker agree on the shape that gets persisted.
 *
 * @param {object} answers   existing answers map (never mutated)
 * @param {object} question  normalized question (needs `id`)
 * @param {object|null} subpoint  normalized subpoint, or null for the parent
 * @param {string} letter    the new option letter ('' clears the answer)
 */
export function withUpdatedAnswer(answers = {}, question, subpoint, letter) {
  const next = { ...(answers || {}) }
  const qId = String(question.id)

  if (!subpoint) {
    const node = next[qId]
    if (node && typeof node === 'object' && !Array.isArray(node)) {
      next[qId] = { ...node, answer: letter }
    } else {
      next[qId] = letter
    }
    return next
  }

  const node = next[qId]
  const nested = node && typeof node === 'object' && !Array.isArray(node)
    ? { ...node }
    : { answer: typeof node === 'string' ? node : '', subpoints: {} }
  nested.subpoints = { ...(nested.subpoints || {}), [String(subpoint.id)]: letter }
  next[qId] = nested
  return next
}

/**
 * ============================ THE MARKER =============================
 * Grade a whole submission against the answer key.
 *
 * NESTED SUBPOINTS
 *   A question may carry an optional `subpoints` array. Each subpoint is a
 *   complete MCQ and is marked on its own, contributing its own points:
 *
 *     question with subpoints -> total = SUM(subpoint points)
 *     question without        -> total = its own `points`
 *
 *   The parent's own `points` value is ignored whenever subpoints exist, so
 *   adding subpoints can never double-count a question. `correctCount`,
 *   `incorrectCount` and `unansweredCount` are tallied per subpoint, which
 *   is why a three-subpoint question can read "2 correct / 1 incorrect".
 *
 * @param {object}  input
 * @param {Array}   input.questions     question definitions (with `answer`)
 * @param {object}  input.modelAnswers  optional `{ id: 'A' }` key override
 * @param {object}  input.answers       the student's answers
 * @param {boolean} input.countUnansweredAsIncorrect  default true
 *
 * @returns {{
 *   totalQuestions:number, gradedQuestions:number, gradedItems:number,
 *   answeredCount:number, unansweredCount:number, correctCount:number,
 *   incorrectCount:number, earnedPoints:number, totalPoints:number,
 *   score:number, percentage:number, hasAnswerKey:boolean, breakdown:Array
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
  let answeredCount = 0
  let earnedPoints = 0
  let totalPoints = 0
  let gradedQuestions = 0
  let gradedItems = 0

  const breakdown = key.map((q) => {
    /* ------------------------------------------------------------------
     * QUESTION WITH NESTED SUBPOINTS
     *   - every subpoint is marked independently against its own key
     *   - the parent's total is the SUM of its subpoint points, so the
     *     parent's own `points` value is never counted a second time
     * ------------------------------------------------------------------ */
    if (q.subpoints?.length) {
      let spEarned = 0
      let spTotal = 0
      let spKeyed = false
      let spAnsweredAny = false

      const subpointRows = q.subpoints.map((sp) => {
        const raw = pickSubpointAnswer(answers, q, sp)
        const answered = raw !== undefined && raw !== null && String(raw).trim() !== ''
        const keyed = hasKey(sp)
        const correct = keyed && answered ? isAnswerCorrect(sp, raw) : false

        if (answered) { answeredCount += 1; spAnsweredAny = true }

        if (keyed) {
          spKeyed = true
          gradedItems += 1
          spTotal += sp.points
          totalPoints += sp.points
          if (correct) {
            correctCount += 1
            spEarned += sp.points
            earnedPoints += sp.points
          } else if (!answered) {
            unansweredCount += 1
            if (countUnansweredAsIncorrect) incorrectCount += 1
          } else {
            incorrectCount += 1
          }
        } else if (!answered) {
          unansweredCount += 1
        }

        return {
          subpointId: sp.id,
          label: sp.label,
          number: sp.number,
          question: sp.question,
          options: sp.options,
          points: sp.points,
          hasKey: keyed,
          answered,
          studentAnswer: answered ? String(raw) : '',
          studentLetter: toOptionLetter(raw, sp.options),
          correctAnswer: sp.correctLetter || sp.correctText || '',
          correctLetter: sp.correctLetter,
          isCorrect: correct,
          earnedPoints: correct ? sp.points : 0,
        }
      })

      if (spKeyed) gradedQuestions += 1

      const parentPoints = Math.round(spTotal * 100) / 100
      return {
        questionId: q.id,
        number: q.number,
        question: q.question,
        options: q.options,
        points: parentPoints,
        hasKey: spKeyed,
        hasSubpoints: true,
        answered: spAnsweredAny,
        // A parent with subpoints has no answer of its own: its mark is
        // the sum of the subpoint marks, and it is "correct" only when
        // every subpoint was answered correctly.
        studentAnswer: '',
        studentLetter: '',
        correctAnswer: '',
        correctLetter: '',
        isCorrect: spKeyed && spTotal > 0 && spEarned === spTotal,
        earnedPoints: Math.round(spEarned * 100) / 100,
        subpoints: subpointRows,
      }
    }

    /* ------------------------- NORMAL QUESTION ------------------------- */
    const studentRaw = pickStudentAnswer(answers, q)
    const answered = studentRaw !== undefined && studentRaw !== null && String(studentRaw).trim() !== ''
    const keyed = hasKey(q)
    const correct = keyed && answered ? isAnswerCorrect(q, studentRaw) : false

    if (answered) answeredCount += 1

    if (keyed) {
      gradedQuestions += 1
      gradedItems += 1
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
      hasSubpoints: false,
      answered,
      studentAnswer: answered ? String(studentRaw) : '',
      studentLetter,
      correctAnswer: q.correctLetter || q.correctText || '',
      correctLetter: q.correctLetter,
      isCorrect: correct,
      earnedPoints: correct ? q.points : 0,
      subpoints: [],
    }
  })

  const roundedEarned = Math.round(earnedPoints * 100) / 100
  const roundedTotal = Math.round(totalPoints * 100) / 100
  const percentage = roundedTotal > 0 ? Math.round((roundedEarned / roundedTotal) * 100) : 0

  return {
    totalQuestions: key.length,
    gradedQuestions,
    /** Gradable items = plain questions + every subpoint, counted once each. */
    gradedItems,
    answeredCount,
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

/**
 * ================== ADMIN REVIEW: BREAKDOWN SELECTION ==================
 * The admin answer editor needs, for every item, the list of OPTIONS and
 * the real answer key. A breakdown that was computed by the browser has
 * both; a breakdown that was STORED BY THE DATABASE does not:
 * `ph_mark_answers` writes the marks per question and deliberately does
 * not repeat the option text into every row.
 *
 * Rendering the editor straight from stored rows therefore produced a
 * dialog with NO options to pick — the "Edit Answer" button existed but
 * could never be confirmed, i.e. an admin could not change a submitted
 * answer at all.
 *
 * This function fixes both problems in one place:
 *
 *   1. it chooses the stored rows when they are detailed enough, and falls
 *      back to the freshly derived breakdown for any question whose
 *      subpoint detail is missing (papers graded before subpoints existed),
 *   2. it re-attaches the definition-derived display fields (options, key
 *      letter, key text, hasKey, roman label) to every row, matching by
 *      STABLE ID first and by question number only as a legacy fallback.
 *
 * It never touches the marks themselves — `isCorrect`, `earnedPoints`,
 * `studentAnswer`, `studentLetter` stay exactly as the database wrote them,
 * so the numbers the admin sees remain the server's numbers.
 *
 * Input rows are never mutated; the returned rows are fresh objects.
 *
 * @param {object} input
 * @param {Array|null} input.stored    `submission.breakdown` as saved by the DB
 * @param {Array} input.derived        breakdown from `gradeSubmissionAgainstKey`
 * @param {Array} input.questions      the entry's question definitions (with keys)
 * @returns {Array} one row per question, ready to render and to edit from
 */
export function buildReviewBreakdown({ stored = null, derived = [], questions = [] } = {}) {
  const key = (Array.isArray(questions) ? questions : []).map(normalizeQuestion)
  const byId = new Map(key.map((q) => [String(q.id), q]))
  const byNumber = new Map(key.map((q) => [String(q.number), q]))
  const defFor = (row) => byId.get(String(row?.questionId ?? ''))
    || byNumber.get(String(row?.number ?? ''))
    || null

  // Use the stored rows only when every question that HAS subpoints also
  // carries one row per subpoint; otherwise the derived breakdown is the
  // only one that can show (and edit) the subpoints at all.
  const storedRows = Array.isArray(stored) && stored.length ? stored : null
  const storedIsDetailed = Boolean(storedRows) && storedRows.every((row) => {
    const def = defFor(row)
    if (!def?.subpoints?.length) return true
    return Array.isArray(row.subpoints) && row.subpoints.length === def.subpoints.length
  })

  const rows = (storedIsDetailed ? storedRows : (Array.isArray(derived) ? derived : [])) || []

  return rows.map((row) => {
    if (!row || typeof row !== 'object') return row
    const def = defFor(row)
    if (!def) return { ...row }

    const out = {
      ...row,
      questionId: row.questionId ?? def.id,
      number: row.number ?? def.number,
      // Marks (`earnedPoints`, `isCorrect`, `studentAnswer`, `studentLetter`)
      // are intentionally left exactly as they arrived.
      question: row.question || def.question || '',
      options: Array.isArray(row.options) && row.options.length ? row.options : def.options || [],
      points: row.points ?? def.points,
      hasKey: row.hasKey ?? hasKey(def),
      hasSubpoints: Boolean(def.hasSubpoints),
      correctLetter: row.correctLetter || def.correctLetter || '',
      correctAnswer: row.correctAnswer || def.correctLetter || def.correctText || '',
    }

    if (!def.hasSubpoints) {
      out.subpoints = Array.isArray(row.subpoints) ? row.subpoints : []
      return out
    }

    const spById = new Map(def.subpoints.map((sp) => [String(sp.id), sp]))
    const spByLabel = new Map(def.subpoints.map((sp) => [String(sp.label), sp]))
    const spByNumber = new Map(def.subpoints.map((sp) => [String(sp.number), sp]))

    out.subpoints = (Array.isArray(row.subpoints) ? row.subpoints : []).map((sp) => {
      if (!sp || typeof sp !== 'object') return sp
      const sd = spById.get(String(sp.subpointId ?? ''))
        || spByLabel.get(String(sp.label ?? ''))
        || spByNumber.get(String(sp.number ?? ''))
        || null
      if (!sd) return { ...sp }
      return {
        ...sp,
        subpointId: sp.subpointId ?? sd.id,
        label: sp.label || sd.label,
        number: sp.number ?? sd.number,
        question: sp.question || sd.question || '',
        options: Array.isArray(sp.options) && sp.options.length ? sp.options : sd.options || [],
        points: sp.points ?? sd.points,
        hasKey: sp.hasKey ?? hasKey(sd),
        correctLetter: sp.correctLetter || sd.correctLetter || '',
        correctAnswer: sp.correctAnswer || sd.correctLetter || sd.correctText || '',
      }
    })

    // A parent row must never look editable: only its subpoints are.
    out.options = []
    return out
  })
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

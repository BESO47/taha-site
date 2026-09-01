/**
 * Sanity checks for the answer-key grading engine.
 * Run with:  node scripts/test-grading.mjs
 */
import assert from 'node:assert/strict'
import {
  gradeSubmissionAgainstKey,
  toOptionLetter,
  buildAnswerKey,
  summarizeGrades,
  romanNumeral,
  withUpdatedAnswer,
  buildReviewBreakdown,
} from '../src/lib/grading.js'

let passed = 0
const check = (name, fn) => {
  fn()
  passed++
  console.log(`  ✓ ${name}`)
}

console.log('\nAnswer-key grading engine\n')

const questions = [
  { id: 'q1', question: 'SI unit of current?', options: ['A) Ampere', 'B) Volt', 'C) Ohm', 'D) Joule'], answer: 'A', points: 5 },
  { id: 'q2', question: 'SI unit of resistance?', options: ['A) Ampere', 'B) Volt', 'C) Ohm', 'D) Joule'], answer: 'C', points: 5 },
  { id: 'q3', question: 'Ohm law: I is proportional to?', options: ['A) R', 'B) V', 'C) P', 'D) Q'], answer: 'B', points: 10 },
]

check('marks every answer against the key (all correct)', () => {
  const r = gradeSubmissionAgainstKey({ questions, answers: { q1: 'A', q2: 'C', q3: 'B' } })
  assert.equal(r.correctCount, 3)
  assert.equal(r.incorrectCount, 0)
  assert.equal(r.earnedPoints, 20)
  assert.equal(r.totalPoints, 20)
  assert.equal(r.percentage, 100)
})

check('weights the score by question points', () => {
  const r = gradeSubmissionAgainstKey({ questions, answers: { q1: 'A', q2: 'B', q3: 'B' } })
  assert.equal(r.correctCount, 2)
  assert.equal(r.incorrectCount, 1)
  assert.equal(r.earnedPoints, 15)
  assert.equal(r.percentage, 75)
})

check('submitting everything wrong scores 0% (never a completion score)', () => {
  const r = gradeSubmissionAgainstKey({ questions, answers: { q1: 'D', q2: 'D', q3: 'D' } })
  assert.equal(r.correctCount, 0)
  assert.equal(r.incorrectCount, 3)
  assert.equal(r.percentage, 0)
})

check('unanswered questions count as incorrect', () => {
  const r = gradeSubmissionAgainstKey({ questions, answers: { q1: 'A' } })
  assert.equal(r.correctCount, 1)
  assert.equal(r.incorrectCount, 2)
  assert.equal(r.unansweredCount, 2)
  assert.equal(r.percentage, 25)
})

check('accepts full option text, lower case and numeric indexes', () => {
  const r = gradeSubmissionAgainstKey({ questions, answers: { q1: 'A) Ampere', q2: 'c', q3: 2 } })
  assert.equal(r.correctCount, 3)
  assert.equal(r.percentage, 100)
})

check('supports 1-based / letter / arabic option resolution', () => {
  assert.equal(toOptionLetter('B', []), 'B')
  assert.equal(toOptionLetter('b)', []), 'B')
  assert.equal(toOptionLetter(3, []), 'C')
  assert.equal(toOptionLetter('أ', []), 'A')
  assert.equal(toOptionLetter('Ohm', ['A) Ampere', 'B) Volt', 'C) Ohm']), 'C')
  assert.equal(toOptionLetter('', []), '')
})

check('legacy lesson model-answer map overrides the question key', () => {
  const key = buildAnswerKey(
    [{ id: '1', options: ['A) x', 'B) y'], correctAnswer: 'A' }],
    { 1: 'B' }
  )
  assert.equal(key[0].correctLetter, 'B')
})

check('model-answer map alone (no question objects) still grades', () => {
  const r = gradeSubmissionAgainstKey({ questions: [], modelAnswers: { 1: 'A', 2: 'B', 3: 'C' }, answers: { 1: 'A', 2: 'B', 3: 'D' } })
  assert.equal(r.totalQuestions, 3)
  assert.equal(r.correctCount, 2)
  assert.equal(r.percentage, 67)
})

check('no answer key -> nothing is auto-graded (no free full marks)', () => {
  const r = gradeSubmissionAgainstKey({
    questions: [{ id: 'q1', question: 'Explain', options: [], answer: '', points: 5 }],
    answers: { q1: 'Long essay' },
  })
  assert.equal(r.hasAnswerKey, false)
  assert.equal(r.totalPoints, 0)
  assert.equal(r.percentage, 0)
})

check('short text answers are compared after normalization (ar digits/harakat)', () => {
  const r = gradeSubmissionAgainstKey({
    questions: [{ id: 'q1', question: 'التيار؟', options: [], answer: '5 أمبير', points: 2 }],
    answers: { q1: '٥ امبير' },
  })
  assert.equal(r.correctCount, 1)
  assert.equal(r.percentage, 100)
})

check('breakdown exposes per-question correctness', () => {
  const r = gradeSubmissionAgainstKey({ questions, answers: { q1: 'A', q2: 'B' } })
  assert.equal(r.breakdown.length, 3)
  assert.equal(r.breakdown[0].isCorrect, true)
  assert.equal(r.breakdown[1].isCorrect, false)
  assert.equal(r.breakdown[1].studentLetter, 'B')
  assert.equal(r.breakdown[1].correctLetter, 'C')
  assert.equal(r.breakdown[2].answered, false)
})

check('class summary averages correctness percentages', () => {
  const s = summarizeGrades([
    { percentage: 100, correctCount: 3, incorrectCount: 0 },
    { percentage: 50, correctCount: 1, incorrectCount: 2 },
  ])
  assert.equal(s.count, 2)
  assert.equal(s.averagePercent, 75)
  assert.equal(s.totalCorrect, 4)
  assert.equal(s.totalIncorrect, 2)
})

/* ================================================================== */
/* NESTED MCQ SUBPOINTS                                                */
/* ================================================================== */
console.log('\nNested MCQ subpoints\n')

const SP_OPTIONS = ['A) Newton', 'B) Inertia', 'C) Zero net force', 'D) Friction']
const nested = [
  { id: 'q1', question: 'SI unit of current?', options: ['A) Ampere', 'B) Volt', 'C) Ohm', 'D) Joule'], answer: 'A', points: 2 },
  {
    id: 'q2',
    question: 'Choose the correct answer for each of the following:',
    // Deliberately wrong: a question with subpoints must be worth the SUM
    // of its subpoint points, never this value.
    points: 99,
    subpoints: [
      { id: 'sp_a', question: "Newton's first law?", options: SP_OPTIONS, answer: 'B', points: 1 },
      { id: 'sp_b', question: 'What is inertia?', options: SP_OPTIONS, answer: 'C', points: 1 },
      { id: 'sp_c', question: 'Net force is zero when…', options: SP_OPTIONS, answer: 'A', points: 1 },
    ],
  },
]

check('roman numerals are generated from position, not stored', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 9, 14, 40].map(romanNumeral),
    ['i', 'ii', 'iii', 'iv', 'v', 'ix', 'xiv', 'xl'])
  assert.equal(romanNumeral(0), '')
  assert.equal(romanNumeral(11), 'xi')
})

check('subpoints are normalized with generated labels and stable ids', () => {
  const [q2] = buildAnswerKey([nested[1]])
  assert.deepEqual(q2.subpoints.map((s) => s.label), ['i', 'ii', 'iii'])
  assert.deepEqual(q2.subpoints.map((s) => s.id), ['sp_a', 'sp_b', 'sp_c'])
  assert.equal(q2.subpoints[1].correctLetter, 'C')
  assert.equal(q2.subpoints[0].options.length, 4)
})

check('every subpoint is graded independently', () => {
  const r = gradeSubmissionAgainstKey({
    questions: nested,
    answers: { q1: 'A', q2: { answer: '', subpoints: { sp_a: 'B', sp_b: 'A', sp_c: 'A' } } },
  })
  assert.equal(r.correctCount, 3, 'q1, i and iii are correct')
  assert.equal(r.incorrectCount, 1, 'ii is wrong')
  assert.equal(r.earnedPoints, 4)
  assert.equal(r.percentage, 80)
})

check('a question with subpoints is worth the SUM of its subpoints (no double count)', () => {
  const r = gradeSubmissionAgainstKey({ questions: nested, answers: {} })
  assert.equal(r.totalPoints, 5, 'parent points of 99 are ignored: 2 + 1 + 1 + 1')
  assert.equal(r.breakdown[1].points, 3)
})

check('subpoint breakdown carries label, key, mark and points', () => {
  const r = gradeSubmissionAgainstKey({
    questions: nested,
    answers: { q2: { subpoints: { sp_a: 'B', sp_b: 'A', sp_c: 'A' } } },
  })
  const q2 = r.breakdown[1]
  assert.equal(q2.hasSubpoints, true)
  assert.deepEqual(q2.subpoints.map((s) => s.label), ['i', 'ii', 'iii'])
  assert.deepEqual(q2.subpoints.map((s) => s.isCorrect), [true, false, true])
  assert.deepEqual(q2.subpoints.map((s) => Number(s.earnedPoints)), [1, 0, 1])
  assert.equal(q2.subpoints[1].correctLetter, 'C')
  assert.equal(q2.isCorrect, false, 'the parent is correct only when all subpoints are')
})

check('deleting a subpoint re-numbers the survivors and keeps answers mapped', () => {
  const trimmed = [{ ...nested[1], subpoints: [nested[1].subpoints[0], nested[1].subpoints[2]] }]
  const r = gradeSubmissionAgainstKey({
    questions: trimmed,
    answers: { q2: { subpoints: { sp_a: 'B', sp_c: 'A' } } },
  })
  assert.deepEqual(r.breakdown[0].subpoints.map((s) => s.label), ['i', 'ii'])
  assert.deepEqual(r.breakdown[0].subpoints.map((s) => s.subpointId), ['sp_a', 'sp_c'])
  assert.equal(r.correctCount, 2, 'sp_c kept its answer after sp_b was removed')
})

check('legacy flat subpoint answers ("q2.sp_a") still grade', () => {
  const r = gradeSubmissionAgainstKey({
    questions: nested,
    answers: { q1: 'A', 'q2.sp_a': 'B', 'q2.sp_b': 'C', 'q2.sp_c': 'A' },
  })
  assert.equal(r.correctCount, 4)
  assert.equal(r.percentage, 100)
})

check('subpoint answers keyed by roman label are accepted too', () => {
  const r = gradeSubmissionAgainstKey({
    questions: nested,
    answers: { q2: { subpoints: { i: 'B', ii: 'C', iii: 'A' } } },
  })
  assert.equal(r.correctCount, 3)
})

check('one subpoint answer can never stand in for the whole question', () => {
  const r = gradeSubmissionAgainstKey({
    questions: [nested[1]],
    answers: { q2: 'B' },
  })
  assert.equal(r.correctCount, 0, 'a bare parent answer marks no subpoint')
  assert.equal(r.unansweredCount, 3, 'all three subpoints stay unanswered')
  assert.equal(r.earnedPoints, 0)
})

check('unanswered subpoints count as incorrect and are reported', () => {
  const r = gradeSubmissionAgainstKey({
    questions: [nested[1]],
    answers: { q2: { subpoints: { sp_a: 'B' } } },
  })
  assert.equal(r.correctCount, 1)
  assert.equal(r.incorrectCount, 2)
  assert.equal(r.unansweredCount, 2)
  assert.equal(r.answeredCount, 1)
  assert.equal(r.gradedItems, 3, 'three subpoints were marked')
  assert.equal(r.earnedPoints, 1)
})

check('withUpdatedAnswer changes one subpoint and leaves the rest alone', () => {
  const key = buildAnswerKey(nested)
  const start = { q1: 'A', q2: { answer: '', subpoints: { sp_a: 'B', sp_b: 'A', sp_c: 'A' } } }
  const next = withUpdatedAnswer(start, key[1], key[1].subpoints[1], 'C')

  assert.equal(next.q2.subpoints.sp_b, 'C', 'the target changed')
  assert.equal(next.q2.subpoints.sp_a, 'B', 'siblings untouched')
  assert.equal(next.q1, 'A', 'the flat answer untouched')
  assert.equal(start.q2.subpoints.sp_b, 'A', 'the original map was not mutated')

  const r = gradeSubmissionAgainstKey({ questions: nested, answers: next })
  assert.equal(r.correctCount, 4)
  assert.equal(r.percentage, 100)
})

check('withUpdatedAnswer keeps the nested shape when writing a parent answer', () => {
  const key = buildAnswerKey(nested)
  const next = withUpdatedAnswer({ q2: { subpoints: { sp_a: 'B' } } }, key[1], null, 'D')
  assert.equal(next.q2.answer, 'D')
  assert.equal(next.q2.subpoints.sp_a, 'B')
})

check('homework without subpoints is completely unaffected', () => {
  const r = gradeSubmissionAgainstKey({ questions, answers: { q1: 'A', q2: 'C', q3: 'B' } })
  assert.equal(r.correctCount, 3)
  assert.equal(r.gradedItems, 3)
  assert.equal(r.percentage, 100)
  assert.deepEqual(r.breakdown.map((b) => b.hasSubpoints), [false, false, false])
})

check('an incomplete subpoint contributes no marks (no free points)', () => {
  const r = gradeSubmissionAgainstKey({
    questions: [{ id: 'q1', question: 'Pick', points: 1, subpoints: [{ id: 'a', question: 'No key', options: SP_OPTIONS, answer: '', points: 1 }] }],
    answers: { q1: { subpoints: { a: 'B' } } },
  })
  assert.equal(r.hasAnswerKey, false)
  assert.equal(r.totalPoints, 0)
  assert.equal(r.percentage, 0)
})

check('legacy subpoints stored under `text` are still read', () => {
  const r = gradeSubmissionAgainstKey({
    questions: [{
      id: 'q1', question: 'Pick', points: 1,
      subpoints: [{ id: 'a', text: 'Legacy field name', options: SP_OPTIONS, answer: 'B', points: 2 }],
    }],
    answers: { q1: { subpoints: { a: 'B' } } },
  })
  assert.equal(r.correctCount, 1)
  assert.equal(r.earnedPoints, 2)
  assert.equal(r.breakdown[0].subpoints[0].question, 'Legacy field name')
})

/* ================== ADMIN REVIEW BREAKDOWN (hydration) ==================
 * `ph_mark_answers` stores per-question MARKS only — no option list. The
 * admin answer editor builds its choice list from the breakdown it is
 * given, so a stored row had to be repaired against the live question
 * definitions. Without that repair the "Edit Answer" dialog opened empty
 * and its confirm button could never be pressed.
 */

/** Verbatim shape of a `submissions.breakdown` written by the database. */
const SQL_STORED = [
  {
    questionId: 'q1', number: 1, question: 'SI unit of current?', points: 5,
    hasKey: true, hasSubpoints: false, answered: true, studentAnswer: 'B', studentLetter: 'B',
    correctAnswer: 'A', isCorrect: false, earnedPoints: 0, subpoints: [],
  },
  {
    questionId: 'q2', number: 2, question: 'SI unit of resistance?', points: 5,
    hasKey: true, hasSubpoints: false, answered: true, studentAnswer: 'C', studentLetter: 'C',
    correctAnswer: 'C', isCorrect: true, earnedPoints: 5, subpoints: [],
  },
]

check('a stored SQL breakdown gains the options the answer editor needs', () => {
  const rows = buildReviewBreakdown({ stored: SQL_STORED, derived: [], questions })
  assert.equal(rows.length, 2)
  assert.deepEqual(rows[0].options, ['A) Ampere', 'B) Volt', 'C) Ohm', 'D) Joule'],
    'options are re-attached from the question definition')
  assert.equal(rows[0].hasSubpoints, false)
  assert.ok(rows.every((r) => (r.options || []).length === 4), 'every question is editable')
})

check('hydration never rewrites the marks the database computed', () => {
  const rows = buildReviewBreakdown({ stored: SQL_STORED, derived: [], questions })
  assert.equal(rows[0].isCorrect, false, 'the wrong answer stays wrong')
  assert.equal(rows[0].earnedPoints, 0)
  assert.equal(rows[0].studentAnswer, 'B', "the student's own answer is untouched")
  assert.equal(rows[0].studentLetter, 'B')
  assert.equal(rows[1].earnedPoints, 5)
  assert.equal(rows[0].correctLetter, 'A', 'the key letter is recovered for highlighting')
})

check('a stored row for a question that has no key stays unmarkable', () => {
  const keyless = [{ questionId: 'q9', number: 1, question: 'Explain', points: 3, hasKey: false,
    answered: true, studentAnswer: 'because', isCorrect: false, earnedPoints: 0 }]
  const rows = buildReviewBreakdown({ stored: keyless, derived: [], questions: [{ id: 'q9', question: 'Explain', points: 3 }] })
  assert.equal(rows[0].hasKey, false)
  assert.deepEqual(rows[0].options, [], 'a text item has no options to pick from')
})

check('papers graded before subpoints existed fall back to the derived rows', () => {
  const nested = [{
    id: 'n1', question: 'Choose for each', points: 99,
    subpoints: [
      { id: 'a', question: 'First?', options: ['A) w', 'B) x', 'C) y', 'D) z'], answer: 'B', points: 1 },
      { id: 'b', question: 'Second?', options: ['A) w', 'B) x', 'C) y', 'D) z'], answer: 'C', points: 1 },
    ],
  }]
  // The old marker stored a single flat row: no subpoint detail at all.
  const stale = [{ questionId: 'n1', number: 1, question: 'Choose for each', points: 2,
    hasKey: true, answered: true, studentAnswer: '', isCorrect: false, earnedPoints: 0 }]
  const derived = gradeSubmissionAgainstKey({ questions: nested, answers: { n1: { subpoints: { a: 'B', b: 'C' } } } })
  const rows = buildReviewBreakdown({ stored: stale, derived: derived.breakdown, questions: nested })
  assert.equal(rows[0].hasSubpoints, true, 'the parent is rendered as a subpoint group')
  assert.equal(rows[0].subpoints.length, 2, 'the subpoint rows come from the derived breakdown')
  assert.ok(rows[0].subpoints.every((sp) => sp.options.length === 4), 'every subpoint is editable')
})

check('legacy positional question ids resolve to the right definition', () => {
  const positional = [{ questionId: '2', number: 2, question: '', points: 5, hasKey: true,
    answered: true, studentAnswer: 'C', isCorrect: true, earnedPoints: 5 }]
  const rows = buildReviewBreakdown({ stored: positional, derived: [], questions })
  assert.deepEqual(rows[0].options, questions[1].options, 'position 2 is the resistance question')
  assert.equal(rows[0].question, 'SI unit of resistance?')
})

check('unknown rows pass through untouched instead of being dropped', () => {
  const foreign = [{ questionId: 'gone', number: 7, question: 'Deleted question', points: 1, hasKey: true,
    answered: true, studentAnswer: 'A', isCorrect: true, earnedPoints: 1 }]
  const rows = buildReviewBreakdown({ stored: foreign, derived: [], questions })
  assert.equal(rows.length, 1)
  assert.deepEqual(rows[0], foreign[0])
})

check('hydration is pure — the stored rows are not modified', () => {
  const stored = SQL_STORED.map((r) => ({ ...r }))
  buildReviewBreakdown({ stored, derived: [], questions })
  assert.deepEqual(stored, SQL_STORED, 'the input breakdown is untouched')
})

console.log(`\n${passed} checks passed\n`)

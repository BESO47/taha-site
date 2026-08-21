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

console.log(`\n${passed} checks passed\n`)

/**
 * =====================================================================
 * UI REGRESSION TESTS — mounts the real React components in a DOM and
 * clicks through them, in BOTH Arabic (RTL) and English (LTR).
 * ---------------------------------------------------------------------
 * These run the shipped JSX, loaded through the project's own Vite
 * pipeline so `import.meta.env`, the JSX transform and every import
 * resolve exactly as they do in the browser.
 *
 * What they prove that the logic tests cannot:
 *   • the student answer sheet renders a nested subpoint as a COMPLETE
 *     MCQ — roman numeral, its own four options, one selection each,
 *   • roman numerals are wrapped in dir="ltr" so an RTL page cannot
 *     visually reorder "ii" / "iii",
 *   • selecting options produces the NESTED submission shape
 *     `{ q2: { answer, subpoints: { <id>: 'C' } } }`,
 *   • the paper is then marked and the score is shown,
 *   • a paper with no subpoints still submits its flat answer,
 *   • the admin editor builds a subpoint as a real 4-option MCQ.
 * =====================================================================
 */
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'

/* ---------- jsdom globals, before any React module is loaded ---------- */
const dom = new JSDOM('<!doctype html><html dir="ltr"><body></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
})
globalThis.window = dom.window
globalThis.document = dom.window.document
Object.defineProperty(globalThis, 'navigator', {
  value: dom.window.navigator, configurable: true, writable: true,
})
globalThis.localStorage = dom.window.localStorage
globalThis.HTMLElement = dom.window.HTMLElement
globalThis.Element = dom.window.Element
globalThis.Node = dom.window.Node
globalThis.Event = dom.window.Event
globalThis.MouseEvent = dom.window.MouseEvent
globalThis.getComputedStyle = dom.window.getComputedStyle
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0)
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const React = (await import('react')).default
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { MemoryRouter } = await import('react-router-dom')
const { createServer } = await import('vite')

const vite = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
})

const OPTIONS = ['A) Newton', 'B) Inertia', 'C) Zero net force', 'D) Friction']

const NESTED_ASSIGNMENT = {
  id: 'hw-nested',
  title: 'Nested MCQ homework',
  totalPoints: 5,
  questions: [
    { id: 'q1', question: 'SI unit of current?', options: ['A) Ampere', 'B) Volt', 'C) Ohm', 'D) Joule'], answer: 'A', points: 2 },
    {
      id: 'q2',
      question: 'Choose the correct answer for each of the following:',
      points: 99, // must be ignored: the question is worth its subpoints
      subpoints: [
        { id: 'sp_a', question: "Newton's first law?", options: OPTIONS, answer: 'B', points: 1 },
        { id: 'sp_b', question: 'What is inertia?', options: OPTIONS, answer: 'C', points: 1 },
        { id: 'sp_c', question: 'Net force is zero when…', options: OPTIONS, answer: 'A', points: 1 },
      ],
    },
  ],
}

const FLAT_ASSIGNMENT = {
  id: 'hw-flat',
  title: 'Legacy flat homework',
  totalPoints: 10,
  questions: [
    { id: 'q1', question: 'Unit of current?', options: ['A) Ampere', 'B) Volt'], answer: 'A', points: 5 },
    { id: 'q2', question: 'Unit of resistance?', options: ['A) Ampere', 'B) Ohm'], answer: 'B', points: 5 },
  ],
}

/** UI strings the tests click on, per language. */
const LABELS = {
  en: { sheet: 'Answer Sheet', review: 'Answer Review', submit: 'Submit & Get My Grade', addHomework: 'New Homework', addSubpoint: 'Add Subpoint', option: 'Option' },
  ar: { sheet: 'ورقة الإجابة', review: 'مراجعة الإجابات', submit: 'تسليم واستخراج الدرجة', addHomework: 'واجب جديد', addSubpoint: 'إضافة نقطة فرعية', option: 'اختيار' },
}

/** Mount a component inside the language provider set to `lang`. */
async function mount(element, lang) {
  const { LanguageProvider } = await vite.ssrLoadModule('/src/lib/i18n.jsx')
  localStorage.setItem('app_lang', lang)
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    // HomeworkTab -> GroupFilterSelect reads the query string, so the tree
    // needs a router exactly as it has one in the real app.
    root.render(
      React.createElement(MemoryRouter, null,
        React.createElement(LanguageProvider, null, element))
    )
  })
  return container
}

const click = async (el) => {
  assert.ok(el, 'the element to click exists')
  await act(async () => {
    el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
  })
}

const flush = async () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })

/** Open the collapsible answer sheet (labelled by review state). */
const openSheet = (container, L) =>
  byText(container, 'button', L.sheet) || byText(container, 'button', L.review)

const byText = (container, selector, text) =>
  Array.from(container.querySelectorAll(selector)).find((n) => n.textContent.includes(text))

const buttonsIn = (node) => Array.from(node.querySelectorAll('button'))

/** Option groups: grids holding exactly N option buttons. */
const optionGroups = (container, n, extraFilter = () => true) =>
  Array.from(container.querySelectorAll('div.grid')).filter(
    (d) => d.querySelectorAll('button').length === n && extraFilter(d)
  )

/** Subpoint option groups live inside the purple subpoint card. */
const inSubpointCard = (d) => (d.parentElement?.className || '').includes('purple-50')
const nestedBlocks = (container) => optionGroups(container, 4, inSubpointCard)
/** The parent question's own option grid is the one NOT in a subpoint card. */
const parentBlocks = (container, n) => optionGroups(container, n, (d) => !inSubpointCard(d))

let passed = 0
const check = async (name, fn) => {
  await fn()
  passed++
  console.log(`  ✓ ${name}`)
}

const { default: HomeworkSubmitCard } = await vite.ssrLoadModule('/src/components/HomeworkSubmitCard.jsx')
const { normalizeAssignmentSubmission } = await vite.ssrLoadModule('/src/lib/api.js')
const { default: HomeworkTab } = await vite.ssrLoadModule('/src/components/admin/HomeworkTab.jsx')

/** The full student flow, run once per language. */
async function studentFlow(lang) {
  const L = LABELS[lang]

  await check(`[${lang}] renders every subpoint as a complete MCQ with a roman label`, async () => {
    localStorage.removeItem('physics_hub_hw_grades')
    const container = await mount(
      React.createElement(HomeworkSubmitCard, { assignment: NESTED_ASSIGNMENT, submission: null, studentId: 'stu-1' }),
      lang
    )
    await click(openSheet(container, L))

    assert.ok(container.textContent.includes("Newton's first law?"))
    assert.ok(container.textContent.includes('What is inertia?'))
    assert.ok(container.textContent.includes('Net force is zero when…'))

    const labels = Array.from(container.querySelectorAll('span[dir="ltr"]'))
      .map((n) => n.textContent.trim())
      .filter((l) => /^(i|ii|iii|iv|v|vi)$/.test(l))
    assert.deepEqual(labels, ['i', 'ii', 'iii'], 'labels are generated in order and isolated with dir="ltr"')
    assert.equal(nestedBlocks(container).length, 3, 'three subpoint option groups, four buttons each')
  })

  await check(`[${lang}] one answer per subpoint, submitted in the nested shape`, async () => {
    localStorage.removeItem('physics_hub_hw_grades')
    const container = await mount(
      React.createElement(HomeworkSubmitCard, { assignment: NESTED_ASSIGNMENT, submission: null, studentId: 'stu-1' }),
      lang
    )
    await click(openSheet(container, L))

    const blocks = nestedBlocks(container)
    await click(buttonsIn(blocks[0])[1]) // i  -> B  (correct)
    await click(buttonsIn(blocks[1])[3]) // ii -> D  (wrong)
    await click(buttonsIn(blocks[1])[2]) // ii -> C  (correct, replaces D)
    await click(buttonsIn(blocks[2])[0]) // iii-> A  (correct)

    // The flat parent question: q1 -> A (correct).
    const flat = parentBlocks(container, 4)[0]
    await click(buttonsIn(flat)[0])

    await click(byText(container, 'button', L.submit))

    const row = (JSON.parse(localStorage.getItem('physics_hub_hw_grades') || '{}')['hw-nested'] || [])[0]
    assert.ok(row, 'the submission was stored')
    assert.equal(row.answers.q1, 'A', 'a flat question still stores a bare letter')
    assert.deepEqual(row.answers.q2.subpoints, { sp_a: 'B', sp_b: 'C', sp_c: 'A' },
      'subpoint answers are stored nested under their stable ids')
    assert.equal(Number(row.score), 5)
    assert.equal(Number(row.correct_count), 4)
    assert.equal(Number(row.incorrect_count), 0)
    assert.equal(Number(row.total_points), 5, 'the parent 99 points were ignored')
    assert.equal(Number(row.percentage), 100)
    assert.ok(container.textContent.includes('100%'), 'the score is shown back to the student')
  })

  await check(`[${lang}] a graded paper locks the options and shows the marks`, async () => {
    // A raw `submissions` row, pushed through the same normalizer the app
    // uses, so the component receives exactly what production gives it.
    const graded = normalizeAssignmentSubmission({
      id: 'sub-1', assignment_id: 'hw-nested', student_id: 'stu-1', status: 'graded',
      answers: { q1: 'A', q2: { answer: '', subpoints: { sp_a: 'B', sp_b: 'D', sp_c: 'A' } } },
      score: 4, total_points: 5, correct_count: 3, incorrect_count: 1,
      unanswered_count: 0, percentage: 80,
      breakdown: [
        { questionId: 'q1', number: 1, question: 'SI unit of current?', points: 2, hasKey: true, hasSubpoints: false, answered: true, studentAnswer: 'A', studentLetter: 'A', correctAnswer: 'A', correctLetter: 'A', isCorrect: true, earnedPoints: 2, subpoints: [] },
        {
          questionId: 'q2', number: 2, question: 'Choose the correct answer for each of the following:',
          points: 3, hasKey: true, hasSubpoints: true, answered: true, isCorrect: false, earnedPoints: 2,
          studentAnswer: '', studentLetter: '', correctAnswer: '', correctLetter: '',
          subpoints: [
            { subpointId: 'sp_a', label: 'i', number: 1, question: "Newton's first law?", options: OPTIONS, points: 1, hasKey: true, answered: true, studentAnswer: 'B', studentLetter: 'B', correctAnswer: 'B', correctLetter: 'B', isCorrect: true, earnedPoints: 1 },
            { subpointId: 'sp_b', label: 'ii', number: 2, question: 'What is inertia?', options: OPTIONS, points: 1, hasKey: true, answered: true, studentAnswer: 'D', studentLetter: 'D', correctAnswer: 'C', correctLetter: 'C', isCorrect: false, earnedPoints: 0 },
            { subpointId: 'sp_c', label: 'iii', number: 3, question: 'Net force is zero when…', options: OPTIONS, points: 1, hasKey: true, answered: true, studentAnswer: 'A', studentLetter: 'A', correctAnswer: 'A', correctLetter: 'A', isCorrect: true, earnedPoints: 1 },
          ],
        },
      ],
      submitted_at: new Date().toISOString(),
    }, NESTED_ASSIGNMENT)
    assert.equal(graded.percentage, 80, 'the normalizer exposes the stored percentage')
    const container = await mount(
      React.createElement(HomeworkSubmitCard, { assignment: NESTED_ASSIGNMENT, submission: graded, studentId: 'stu-1' }),
      lang
    )
    await click(openSheet(container, L))
    assert.ok(container.textContent.includes('80%'))
    assert.ok(container.textContent.includes('4 / 5'))
    const disabled = Array.from(container.querySelectorAll('button')).filter((b) => b.disabled)
    assert.ok(disabled.length >= 16, `every option is locked once graded (${disabled.length} disabled)`)
  })

  await check(`[${lang}] the SQL breakdown shape (correctAnswer only) still reveals the key`, async () => {
    // `ph_mark_answers` emits `correctAnswer` but NOT `correctLetter`. A
    // paper graded in the database must still highlight the right option.
    const sqlShaped = normalizeAssignmentSubmission({
      id: 'sub-2', assignment_id: 'hw-nested', student_id: 'stu-1', status: 'graded',
      answers: { q1: 'B', q2: { answer: '', subpoints: { sp_a: 'B', sp_b: 'D', sp_c: 'A' } } },
      score: 3, total_points: 5, correct_count: 2, incorrect_count: 2,
      unanswered_count: 0, percentage: 60,
      breakdown: [
        { questionId: 'q1', number: 1, question: 'SI unit of current?', options: ['A) Ampere', 'B) Volt', 'C) Ohm', 'D) Joule'], points: 2, hasKey: true, hasSubpoints: false, answered: true, studentAnswer: 'B', studentLetter: 'B', correctAnswer: 'A', isCorrect: false, earnedPoints: 0, subpoints: [] },
        {
          questionId: 'q2', number: 2, question: 'Choose the correct answer for each of the following:',
          options: [], points: 3, hasKey: true, hasSubpoints: true, answered: true,
          studentAnswer: '', studentLetter: null, correctAnswer: null, isCorrect: false, earnedPoints: 1,
          subpoints: [
            { subpointId: 'sp_a', label: 'i', number: 1, question: "Newton's first law?", options: OPTIONS, points: 1, hasKey: true, answered: true, studentAnswer: 'B', studentLetter: 'B', correctAnswer: 'B', isCorrect: true, earnedPoints: 1 },
            { subpointId: 'sp_b', label: 'ii', number: 2, question: 'What is inertia?', options: OPTIONS, points: 1, hasKey: true, answered: true, studentAnswer: 'D', studentLetter: 'D', correctAnswer: 'C', isCorrect: false, earnedPoints: 0 },
            { subpointId: 'sp_c', label: 'iii', number: 3, question: 'Net force is zero when…', options: OPTIONS, points: 1, hasKey: true, answered: true, studentAnswer: 'A', studentLetter: 'A', correctAnswer: 'A', isCorrect: true, earnedPoints: 1 },
          ],
        },
      ],
      submitted_at: new Date().toISOString(),
    }, NESTED_ASSIGNMENT)

    const container = await mount(
      React.createElement(HomeworkSubmitCard, { assignment: NESTED_ASSIGNMENT, submission: sqlShaped, studentId: 'stu-1' }),
      lang
    )
    await click(openSheet(container, L))

    // The parent question's wrong choice is flagged and the key is marked.
    const flat = parentBlocks(container, 4)[0]
    const flatButtons = buttonsIn(flat)
    assert.ok(flatButtons[0].textContent.includes('✓'), 'the correct parent option is revealed')
    assert.ok(flatButtons[1].textContent.includes('✕'), "the student's wrong choice is flagged")

    // Each subpoint reveals its own key.
    const blocks = nestedBlocks(container)
    assert.ok(buttonsIn(blocks[0])[1].textContent.includes('✓'), 'i: key B revealed')
    assert.ok(buttonsIn(blocks[1])[2].textContent.includes('✓'), 'ii: key C revealed')
    assert.ok(buttonsIn(blocks[1])[3].textContent.includes('✕'), 'ii: wrong D flagged')
    assert.ok(buttonsIn(blocks[2])[0].textContent.includes('✓'), 'iii: key A revealed')
  })

  await check(`[${lang}] homework without subpoints keeps the flat answer format`, async () => {
    localStorage.removeItem('physics_hub_hw_grades')
    const container = await mount(
      React.createElement(HomeworkSubmitCard, { assignment: FLAT_ASSIGNMENT, submission: null, studentId: 'stu-2' }),
      lang
    )
    await click(openSheet(container, L))
    const groups = parentBlocks(container, 2)
    assert.equal(groups.length, 2)
    await click(buttonsIn(groups[0])[0]) // q1 -> A (correct)
    await click(buttonsIn(groups[1])[0]) // q2 -> A (key is B)
    await click(byText(container, 'button', L.submit))

    const row = (JSON.parse(localStorage.getItem('physics_hub_hw_grades') || '{}')['hw-flat'] || [])[0]
    assert.deepEqual(row.answers, { q1: 'A', q2: 'A' }, 'unchanged flat format')
    assert.equal(Number(row.score), 5)
    assert.equal(Number(row.percentage), 50)
  })
}

console.log('\nHomework UI (real components, mounted in a DOM)\n')

try {
  await studentFlow('en')
  await studentFlow('ar')

  await check('the admin editor builds a subpoint as a real 4-option MCQ', async () => {
    const L = LABELS.en
    const container = await mount(React.createElement(HomeworkTab), 'en')
    await flush()
    await flush()

    await click(byText(container, 'button', L.addHomework))
    await flush()

    await click(byText(container, 'button', L.addSubpoint))
    await click(byText(container, 'button', L.addSubpoint))
    await flush()

    const labels = Array.from(container.querySelectorAll('span[dir="ltr"]'))
      .map((n) => n.textContent.trim())
      .filter((l) => /^(i|ii|iii|iv|v|vi)$/.test(l))
    assert.deepEqual(labels, ['i', 'ii'], 'subpoints are numbered from their position')

    const optionInputs = Array.from(container.querySelectorAll(`input[placeholder*="${L.option}"]`))
    assert.equal(optionInputs.length, 8, `4 options x 2 subpoints, got ${optionInputs.length}`)

    const keySelects = Array.from(container.querySelectorAll('select')).filter(
      (s) => Array.from(s.options).map((o) => o.value).join(',') === ',A,B,C,D'
    )
    assert.equal(keySelects.length, 2, 'each subpoint has its own correct-answer select')

    assert.ok(container.textContent.includes('sum of subpoints'),
      'the parent points are replaced by the sum of its subpoints')
  })

  console.log(`\n${passed} checks passed\n`)
} catch (err) {
  console.error(`\n✗ ${err.message}`)
  const frame = (err.stack || '').split('\n').find((l) => l.includes('test-ui.mjs'))
  if (frame) console.error(`  ${frame.trim()}`)
  console.log('')
  process.exitCode = 1
}

await vite.close()
process.exit(process.exitCode || 0)

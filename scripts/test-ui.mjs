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
  server: { middlewareMode: true, hmr: false },
  appType: 'custom',
  logLevel: 'error',
})

// Same app, but every `../lib/api` import resolves to a data layer whose
// registration group reader throws — used to check error reporting.
const viteGroupFailure = await createServer({
  server: { middlewareMode: true, ws: { port: 24699 } },
  appType: 'custom',
  logLevel: 'error',
  resolve: {
    alias: [{
      find: '../lib/api',
      replacement: new URL('./fixtures/api-group-failure.js', import.meta.url).pathname,
    }],
  },
})

// Same app, but `../../lib/api` (as the admin tabs import it) resolves to
// a data layer that records adminCreateStudent() calls instead of talking
// to Supabase — used to check the "Add Student" dialog.
const viteAdminCreate = await createServer({
  server: { middlewareMode: true, ws: { port: 24700 } },
  appType: 'custom',
  logLevel: 'error',
  resolve: {
    alias: [{
      find: '../../lib/api',
      replacement: new URL('./fixtures/api-admin-create.js', import.meta.url).pathname,
    }],
  },
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


  /* ------------- ADMIN: change ONE submitted answer (regression) -------------
   * `ph_mark_answers` writes MARKS only into `submissions.breakdown` — it does
   * not repeat the option list of a plain question. Rendered naively, that
   * stored row gave the "Edit Answer" dialog nothing to choose from and its
   * confirm button stayed disabled: an admin could not change a submitted
   * answer at all. The dialog must therefore be driven by the live question
   * definitions, whatever the database happened to store.
   */
  const ADMIN_ENTRY = {
    id: 'hw-edit',
    title: 'Editable homework',
    year_id: '5',
    total_points: 10,
    max_score: 10,
    is_published: true,
    group_name: '',
    questions: [
      { id: 'q1', question: 'SI unit of current?', options: ['A) Ampere', 'B) Volt', 'C) Ohm', 'D) Joule'], answer: 'A', points: 5 },
      { id: 'q2', question: 'Unit of resistance?', options: ['A) Ampere', 'B) Volt', 'C) Ohm', 'D) Joule'], answer: 'C', points: 5 },
    ],
  }
  const ADMIN_STUDENT = {
    id: 'stu-edit', full_name: 'Editable Student', phone: '01000000009', parent_phone: '',
    year_id: '5', group_name: '', governorate: 'Cairo', is_active: true, role: 'student',
  }
  /** A graded row exactly as the database stores it — no `options` anywhere. */
  const ADMIN_SUB = {
    id: 'sub-edit-1', assignment_id: 'hw-edit', student_id: 'stu-edit', status: 'graded',
    answers: { q1: 'B', q2: 'D' }, score: 0, total_points: 10, correct_count: 0,
    incorrect_count: 2, unanswered_count: 0, percentage: 0,
    breakdown: [
      { questionId: 'q1', number: 1, question: 'SI unit of current?', points: 5, hasKey: true, hasSubpoints: false,
        answered: true, studentAnswer: 'B', studentLetter: 'B', correctAnswer: 'A', isCorrect: false, earnedPoints: 0, subpoints: [] },
      { questionId: 'q2', number: 2, question: 'Unit of resistance?', points: 5, hasKey: true, hasSubpoints: false,
        answered: true, studentAnswer: 'D', studentLetter: 'D', correctAnswer: 'C', isCorrect: false, earnedPoints: 0, subpoints: [] },
    ],
    feedback: '', submitted_at: new Date().toISOString(),
  }

  const EDIT_LABELS = {
    en: { grading: 'Submissions & Grading', review: 'Answer Review', edit: 'Edit Answer', cont: 'Continue' },
    ar: { grading: 'التسليمات والتصحيح', review: 'مراجعة الإجابات', edit: 'تعديل الإجابة', cont: 'متابعة' },
  }
  const seedAdminEdit = (subs) => {
    localStorage.setItem('physics_hub_homework_entries', JSON.stringify([ADMIN_ENTRY]))
    localStorage.setItem('physics_hub_hw_grades', JSON.stringify({ 'hw-edit': subs }))
    localStorage.setItem('physics_hub_sample_students', JSON.stringify([ADMIN_STUDENT]))
  }
  const letterButtons = (root) =>
    Array.from(root.querySelectorAll('button')).filter((b) => /^[A-F]\)\s/.test(b.textContent.trim()))

  for (const lang of ['en', 'ar']) {
    await check(`[${lang}] the editor offers every option of a question stored by the database`, async () => {
      seedAdminEdit([ADMIN_SUB])
      const L = EDIT_LABELS[lang]
      const container = await mount(React.createElement(HomeworkTab), lang)
      await flush()
      await flush()

      await click(byText(container, 'button', L.grading))
      const eye = Array.from(container.querySelectorAll('button')).find((b) => b.title === L.review)
      assert.ok(eye, 'a submitted paper can be opened for review')
      await click(eye)

      const edits = Array.from(container.querySelectorAll('button')).filter((b) => b.textContent.includes(L.edit))
      assert.equal(edits.length, 2, 'one editor per question of the paper')

      await click(edits[0])
      const dialog = container.querySelector('[class*="z-[70]"]')
      assert.ok(dialog, 'the edit dialog is open')
      const options = letterButtons(dialog)
      assert.equal(options.length, 4, 'the four options of the question are listed')
      assert.ok(dialog.textContent.includes('Ampere'), 'the option texts come from the real question')

      const continueBtn = () => Array.from(dialog.querySelectorAll('button'))
        .find((b) => b.textContent.trim() === L.cont)
      assert.ok(continueBtn().disabled, 'nothing can be confirmed before a choice is made')

      await click(options[1]) // B — exactly what the student already wrote
      assert.ok(continueBtn().disabled, 're-submitting the same answer is not a change')

      await click(options[0]) // A
      assert.equal(continueBtn().disabled, false, 'a different answer unlocks the confirmation step')

      // The marks shown in the review come from the database, not from here.
      assert.ok(container.textContent.includes('0 / 10'), 'the stored score is displayed untouched')
    })
  }

  await check('a paper with no recorded answers can still be opened and corrected', async () => {
    seedAdminEdit([{
      ...ADMIN_SUB, id: 'sub-edit-2', answers: {}, breakdown: [], score: null,
      correct_count: null, incorrect_count: null, percentage: null, status: 'submitted',
    }])
    const L = EDIT_LABELS.en
    const container = await mount(React.createElement(HomeworkTab), 'en')
    await flush()
    await flush()

    await click(byText(container, 'button', L.grading))
    const eye = Array.from(container.querySelectorAll('button')).find((b) => b.title === L.review)
    assert.ok(eye, 'an unanswered paper is not hidden from the reviewer')
    await click(eye)
    const edits = Array.from(container.querySelectorAll('button')).filter((b) => b.textContent.includes(L.edit))
    assert.equal(edits.length, 2, 'a missing answer can be given, question by question')
    await click(edits[0])
    assert.equal(letterButtons(container.querySelector('[class*="z-[70]"]')).length, 4)
  })


  /* ---------------- REGISTRATION: grade -> group selector ------------ */
  const { default: RegisterPage } = await vite.ssrLoadModule('/src/pages/RegisterPage.jsx')

  const REG_GROUPS = [
    { id: 'grp-a1', name: 'Group A1', year_id: '5', description: '' },
    { id: 'grp-a2', name: 'Group A2', year_id: '5', description: '' },
    { id: 'grp-b1', name: 'Group B1', year_id: '6', description: '' },
  ]

  /** The group <select> is the one whose options are the group names. */
  const groupSelect = (container) =>
    Array.from(container.querySelectorAll('select')).find((sel) =>
      Array.from(sel.options).some((o) => o.value.startsWith('grp-')) ||
      Array.from(sel.options).every((o) => !o.value || o.value.startsWith('grp-'))
    )
  const gradeSelect = (container) =>
    Array.from(container.querySelectorAll('select')).find((sel) =>
      Array.from(sel.options).map((o) => o.value).join(',') === '5,6'
    )
  const setSelect = async (sel, value) => {
    await act(async () => {
      sel.value = value
      sel.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
    })
    await flush()
  }

  for (const lang of ['en', 'ar']) {
    await check(`[${lang}] signup shows only the groups of the selected grade`, async () => {
      localStorage.setItem('physics_hub_groups', JSON.stringify(REG_GROUPS))
      const container = await mount(React.createElement(RegisterPage), lang)
      await flush()

      const groups = groupSelect(container)
      assert.ok(groups, 'the group selector is rendered')
      const names = () => Array.from(groups.options).filter((o) => o.value).map((o) => o.textContent.trim())
      assert.deepEqual(names(), ['Group A1', 'Group A2'], '2nd secondary groups only')

      // Pick one, then switch grade: the choice resets and the list reloads.
      await setSelect(groups, 'grp-a2')
      assert.equal(groupSelect(container).value, 'grp-a2')

      await setSelect(gradeSelect(container), '6')
      const after = groupSelect(container)
      assert.equal(after.value, '', 'changing the grade clears the selected group')
      assert.deepEqual(
        Array.from(after.options).filter((o) => o.value).map((o) => o.textContent.trim()),
        ['Group B1'],
        'only 3rd secondary groups remain'
      )
      localStorage.removeItem('physics_hub_groups')
    })

    await check(`[${lang}] a group backend failure is reported, not hidden`, async () => {
      // The page is rebuilt against a data layer whose group reader fails,
      // exactly as it does when RLS hides the table or the migration is
      // missing. A backend error must never look like "no groups yet".
      const consoleError = console.error
      console.error = () => {}   // the page logs the failure on purpose
      const { default: FailingRegisterPage } = await viteGroupFailure.ssrLoadModule('/src/pages/RegisterPage.jsx')
      const { LanguageProvider } = await viteGroupFailure.ssrLoadModule('/src/lib/i18n.jsx')
      localStorage.setItem('app_lang', lang)
      const container = document.createElement('div')
      document.body.appendChild(container)
      await act(async () => {
        createRoot(container).render(
          React.createElement(MemoryRouter, null,
            React.createElement(LanguageProvider, null, React.createElement(FailingRegisterPage)))
        )
      })
      await flush()

      const text = container.textContent
      assert.ok(
        lang === 'ar'
          ? text.includes('تعذر تحميل المجموعات')
          : text.includes('Unable to load groups'),
        'the visitor is told the groups could not be loaded'
      )
      assert.ok(
        !text.includes('No groups available for this grade yet') &&
        !text.includes('لا توجد مجموعات متاحة لهذا الصف بعد'),
        'an error is never presented as an empty group list'
      )
      assert.ok(
        text.includes(lang === 'ar' ? 'إعادة المحاولة' : 'Retry'),
        'and is offered a retry'
      )
      console.error = consoleError
    })

  }

  /* ================================================================
   * ADMIN CREATES A STUDENT ACCOUNT
   * ================================================================ */
  {
    const { default: StudentsTab } = await viteAdminCreate.ssrLoadModule('/src/components/admin/StudentsTab.jsx')
    const { createCalls } = await viteAdminCreate.ssrLoadModule('/scripts/fixtures/api-admin-create.js')
    const { LanguageProvider } = await viteAdminCreate.ssrLoadModule('/src/lib/i18n.jsx')

    const mountTab = async (lang) => {
      localStorage.setItem('app_lang', lang)
      const container = document.createElement('div')
      document.body.appendChild(container)
      await act(async () => {
        createRoot(container).render(
          React.createElement(MemoryRouter, null,
            React.createElement(LanguageProvider, null, React.createElement(StudentsTab, { students: [], analytics: [] })))
        )
      })
      await flush()
      await flush()
      return container
    }

    const ADD_LABELS = {
      en: { add: 'Add Student', create: 'Create Account' },
      ar: { add: 'إضافة طالب', create: 'إنشاء الحساب' },
    }

    // Everything below is scoped to the dialog: the tab behind it has its
    // own grade/group filters that would otherwise be matched.
    const modalOf = (container) => {
      const dialog = container.querySelector('.fixed.inset-0')
      assert.ok(dialog, 'the Add Student dialog is open')
      return dialog
    }
    const groupSelectIn = (root) =>
      Array.from(root.querySelectorAll('select')).find((sel) =>
        Array.from(sel.options).some((o) => o.value.startsWith('grp-'))
      )
    const gradeSelectIn = (root) =>
      Array.from(root.querySelectorAll('select')).find(
        (sel) => Array.from(sel.options).map((o) => o.value).join(',') === '5,6'
      )

    const fillCreateForm = async (container, values) => {
      const root = modalOf(container)
      const byLabel = (type, index) =>
        Array.from(root.querySelectorAll(`input[type="${type}"]`))[index]
      const set = async (input, value) => {
        await act(async () => {
          const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set
          setter.call(input, value)
          input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
        })
      }
      await set(byLabel('text', 0), values.fullName)
      await set(root.querySelector('input[type="email"]'), values.email)
      const passwords = Array.from(root.querySelectorAll('input[type="password"]'))
      await set(passwords[0], values.password)
      await set(passwords[1], values.confirmPassword ?? values.password)
      const phones = Array.from(root.querySelectorAll('input[type="tel"]'))
      await set(phones[0], values.phone)
      await set(phones[1], values.parentPhone)
      await flush()
    }

    for (const lang of ['en', 'ar']) {
      await check(`[${lang}] the admin dialog only offers groups of the chosen grade`, async () => {
        const L = ADD_LABELS[lang]
        const container = await mountTab(lang)
        await click(byText(container, 'button', L.add))
        await flush()

        const grade = gradeSelectIn(modalOf(container))
        const groups = groupSelectIn(modalOf(container))
        assert.ok(grade && groups, 'the dialog has a grade and a group selector')
        assert.deepEqual(
          Array.from(groups.options).filter((o) => o.value).map((o) => o.textContent.trim()),
          ['Group A (2nd Sec)'],
          '2nd secondary groups only'
        )

        await setSelect(groups, 'grp-5a')
        await setSelect(grade, '6')
        const after = groupSelectIn(modalOf(container))
        assert.equal(after.value, '', 'changing the grade clears the group')
        assert.deepEqual(
          Array.from(after.options).filter((o) => o.value).map((o) => o.textContent.trim()),
          ['Group A (3rd Sec)'],
          '3rd secondary groups only'
        )
      })

      await check(`[${lang}] mismatched passwords are refused before any account is made`, async () => {
        const L = ADD_LABELS[lang]
        createCalls.length = 0
        const container = await mountTab(lang)
        await click(byText(container, 'button', L.add))
        await flush()
        await fillCreateForm(container, {
          fullName: 'Sara Ali', email: 'sara@x.test',
          password: 'CreatedPass1', confirmPassword: 'CreatedPass2',
          phone: '01011112233', parentPhone: '01011112244',
        })
        await click(byText(modalOf(container), 'button', L.create))
        await flush()

        assert.equal(createCalls.length, 0, 'nothing is sent to the backend')
        assert.ok(
          container.textContent.includes(lang === 'ar' ? 'كلمتا المرور غير متطابقتين' : 'Passwords do not match'),
          'the admin is told why'
        )
      })

      await check(`[${lang}] a valid form posts the same fields the signup form collects`, async () => {
        const L = ADD_LABELS[lang]
        createCalls.length = 0
        const container = await mountTab(lang)
        await click(byText(container, 'button', L.add))
        await flush()
        await fillCreateForm(container, {
          fullName: '  Sara   Ali  ', email: ' SARA@x.test ',
          password: 'CreatedPass1',
          phone: '01011112233', parentPhone: '01011112244',
        })
        await setSelect(groupSelectIn(modalOf(container)), 'grp-5a')
        await click(byText(modalOf(container), 'button', L.create))
        await flush()

        assert.equal(createCalls.length, 1, 'exactly one account is created')
        const sent = createCalls[0]
        assert.equal(sent.fullName, 'Sara Ali', 'the name is trimmed')
        assert.equal(sent.email, 'sara@x.test', 'the email is lower-cased')
        assert.equal(sent.password, 'CreatedPass1')
        assert.equal(sent.phone, '201011112233', 'phones are normalized like at signup')
        assert.equal(sent.parentPhone, '201011112244')
        assert.equal(sent.yearId, '5')
        assert.equal(sent.groupId, 'grp-5a')
        assert.equal(sent.isActive, true)

        // The password is shown ONCE so the teacher can hand it over.
        assert.ok(container.textContent.includes('CreatedPass1'), 'the credentials are shown after creation')
        assert.ok(
          container.textContent.includes(lang === 'ar' ? 'تم إنشاء الحساب' : 'The account is created'),
          'and the admin is told the student can sign in'
        )
      })
    }
  }

  console.log(`\n${passed} checks passed\n`)
} catch (err) {
  console.error(`\n✗ ${err.message}`)
  const frame = (err.stack || '').split('\n').find((l) => l.includes('test-ui.mjs'))
  if (frame) console.error(`  ${frame.trim()}`)
  console.log('')
  process.exitCode = 1
}

await vite.close()
await viteGroupFailure.close()
await viteAdminCreate.close()
process.exit(process.exitCode || 0)

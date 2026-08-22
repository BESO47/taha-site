/**
 * Student Messaging — frontend logic validation tests.
 *
 * These tests import the dependency-free modules directly in Node:
 *   - src/lib/phoneCore.js  (normalization, validation, chat URLs)
 *   - src/lib/messaging.js  (template variables & bulk message building)
 *
 * Regression coverage:
 *   1. buildBulkMessages no longer crashes with ReferenceError:
 *      buildChatUrl is not defined (the original production outage).
 *   2. {{overall_attendance}} never leaks raw into a message when
 *      attendance_percent is null (percent-mode fallback).
 *   3. Single / multi-select / "select all filtered" bulk resolution all
 *      produce valid, personalized, URL-carrying messages.
 *   4. Desktop vs mobile deep links route to the right host.
 *
 * Run: node scripts/test-messaging.mjs
 */

import assert from 'node:assert/strict'
import {
  normalizePhone,
  formatPhoneWithPlus,
  validatePhone,
  isMobileDevice,
  buildChatUrl,
  buildNativeWhatsAppUrl,
} from '../src/lib/phoneCore.js'
import {
  buildVariableValues,
  compileTemplate,
  buildBulkMessages,
  TEMPLATE_VARIABLES,
} from '../src/lib/messaging.js'

let passed = 0
const check = (name, fn) => {
  try {
    fn()
    passed += 1
    console.log(`  \u2713 ${name}`)
  } catch (err) {
    console.error(`  \u2717 ${name}`)
    console.error(String(err.stack || err))
    process.exit(1)
  }
}

/* ------------------------------------------------------------------ */
console.log('\nPhone normalization & validation (phoneCore)\n')

check('Egyptian local numbers normalize to 20XXXXXXXXXX', () => {
  assert.equal(normalizePhone('01012345678'), '201012345678')
  assert.equal(normalizePhone('011 2345 6789'), '201123456789')
  assert.equal(normalizePhone('+2010 1234 5678'), '201012345678')
  assert.equal(normalizePhone('00201012345678'), '201012345678')
  assert.equal(normalizePhone('1012345678'), '201012345678') // missing leading 0
  assert.equal(normalizePhone('+966 50 123 4567'), '966501234567') // international untouched
})

check('Egyptian mobile validation accepts valid prefixes and rejects the rest', () => {
  for (const p of ['01012345678', '01112345678', '01212345678', '01512345678']) {
    assert.equal(validatePhone(p).isValid, true, p)
  }
  assert.equal(validatePhone('01312345678').isValid, false) // bad prefix
  assert.equal(validatePhone('010123').isValid, false) // too short
  assert.equal(validatePhone('').isValid, false) // empty
  assert.equal(validatePhone(null).isValid, false)
})

check('formatPhoneWithPlus renders +20…', () => {
  assert.equal(formatPhoneWithPlus('01012345678'), '+201012345678')
  assert.equal(formatPhoneWithPlus(''), '')
})

/* ------------------------------------------------------------------ */
console.log('\nWhatsApp deep links — desktop vs mobile routing\n')

check('isMobileDevice is false under Node (browser-less)', () => {
  assert.equal(isMobileDevice(), false)
})

check('buildChatUrl targets web.whatsapp.com on desktop', () => {
  const url = buildChatUrl('01012345678', 'Hello', { mobile: false })
  assert.match(url, /^https:\/\/web\.whatsapp\.com\/send\?phone=201012345678&text=Hello$/)
})

check('buildChatUrl targets api.whatsapp.com on mobile', () => {
  const url = buildChatUrl('01012345678', 'Hello', { mobile: true })
  assert.match(url, /^https:\/\/api\.whatsapp\.com\/send\?phone=201012345678&text=Hello$/)
})

check('Arabic messages are URI-encoded intact', () => {
  const url = buildChatUrl('01012345678', 'مرحباً بالطالب 👋', { mobile: true })
  assert.equal(decodeURIComponent(url.split('text=')[1]), 'مرحباً بالطالب 👋')
})

check('Native scheme fallback exists and empty phone yields null', () => {
  assert.match(buildNativeWhatsAppUrl('01012345678', 'hi'), /^whatsapp:\/\/send\?phone=201012345678/)
  assert.equal(buildChatUrl('', 'hi'), null)
  assert.equal(buildNativeWhatsAppUrl('', 'hi'), null)
})

/* ------------------------------------------------------------------ */
console.log('\nTemplate variable resolution\n')

check('{{overall_attendance}} percent mode falls back to counts (null regression)', () => {
  const record = {
    full_name: 'Sara',
    total_sessions: 10,
    present_count: 8,
    late_count: 0,
    attendance_percent: null, // missing in DB — used to leak the raw tag
  }
  const values = buildVariableValues(record, { lang: 'en', attendance: 'percent' })
  assert.equal(values.overall_attendance, '80%')
  const message = compileTemplate('Attendance: {{overall_attendance}}', values)
  assert.equal(message, 'Attendance: 80%')
  assert.ok(!message.includes('{{'), 'no unreplaced tags')
})

check('attendance formats: percent / ratio / both', () => {
  const record = { total_sessions: 12, present_count: 9, late_count: 1, attendance_percent: 83.3 }
  assert.equal(buildVariableValues(record, { lang: 'en', attendance: 'percent' }).overall_attendance, '83.3%')
  assert.equal(buildVariableValues(record, { lang: 'en', attendance: 'ratio' }).overall_attendance, '10/12')
  assert.equal(buildVariableValues(record, { lang: 'en', attendance: 'both' }).overall_attendance, '83.3% (10/12)')
})

check('missing data degrades to dashes, never empty strings or raw tags', () => {
  const values = buildVariableValues({}, { lang: 'ar', attendance: 'both' })
  assert.equal(values.overall_attendance, '—')
  assert.equal(values.last_quiz_score, '—')
  assert.equal(values.last_session_attendance, '—')
  const message = compileTemplate('{{overall_attendance}}|{{last_quiz_score}}', values)
  assert.equal(message, '—|—')
})

check('compileTemplate supports {{tag}} and {tag}, keeps unknown tags', () => {
  const out = compileTemplate('Hi {student_name} / {{student_name}} / {{unknown_tag}}', { student_name: 'Omar' })
  assert.equal(out, 'Hi Omar / Omar / {{unknown_tag}}')
})

check('known-but-empty variables render a dash, never leak the raw tag', () => {
  const values = buildVariableValues({ full_name: 'Ahmed' }, { lang: 'en' }) // no parent_name recorded
  const out = compileTemplate('Parent: {{parent_name}} — Student: {{student_name}}', values)
  assert.equal(out, 'Parent: — — Student: Ahmed')
})

/* ------------------------------------------------------------------ */
console.log('\nRecipient resolution — single, multi and bulk-filtered\n')

const RECIPIENTS = [
  { student_id: 's1', full_name: 'أحمد علي', phone: '01012345678', parent_phone: '01198765432', total_sessions: 4, present_count: 4, attendance_percent: 100, last_session_attendance: 'present', last_quiz_score: 18, last_quiz_max: 20, last_homework_score: 9, last_homework_max: 10, group_name: 'A' },
  { student_id: 's2', full_name: 'Mona Samy', phone: '01312345678', group_name: 'B' }, // invalid EG prefix (013…)
  { student_id: 's3', full_name: 'كرم سيد', phone: '', group_name: 'A' }, // no phone at all -> excluded
  { student_id: 's4', full_name: 'Laila Nabil', phone: '+966501234567', group_name: 'C' },
]

check('single student selection produces one personalized message with a URL', () => {
  const messages = buildBulkMessages([RECIPIENTS[0]], 'مرحباً {{student_name}} — مجموعة {{group_name}}', { lang: 'ar' })
  assert.equal(messages.length, 1)
  assert.equal(messages[0].message, 'مرحباً أحمد علي — مجموعة A')
  assert.equal(messages[0].isValid, true)
  assert.ok(messages[0].url.startsWith('https://'), 'wa.me/web URL built (no ReferenceError)')
  assert.ok(messages[0].url.includes('201012345678'))
})

check('multi-select skips phone-less rows and flags invalid numbers without throwing', () => {
  const messages = buildBulkMessages(RECIPIENTS.slice(0, 3), 'Hi {{student_name}}', { lang: 'en' })
  assert.equal(messages.length, 2, 's3 has no phone and must be excluded')
  const [a, b] = messages
  assert.equal(a.isValid, true)
  assert.equal(b.isValid, false)
  assert.equal(b.url, null)
  assert.ok(b.error)
})

check('bulk ("select all filtered") resolves every record and never crashes on any variable', () => {
  // Template containing EVERY exposed variable — guards against future
  // undefined-helper regressions like the buildChatUrl ReferenceError.
  const template = TEMPLATE_VARIABLES.map((v) => `{{${v.key}}}`).join(' | ')
  const bulk = Array.from({ length: 2000 }, (_, i) => ({ ...RECIPIENTS[0], student_id: `bulk-${i}`, full_name: `Student ${i}` }))
  const started = Date.now()
  const messages = buildBulkMessages([...RECIPIENTS, ...bulk], template, { lang: 'ar', attendance: 'both', recipientType: 'student' })
  const elapsed = Date.now() - started
  assert.equal(messages.length, RECIPIENTS.filter((r) => r.phone).length + 2000)
  for (const m of messages) assert.ok(!/\{\{[a-z_]+\}\}/.test(m.message), `unreplaced tag in: ${m.message}`)
  assert.ok(elapsed < 2000, `2000+ recipients compiled in ${elapsed}ms (no UI freeze)`)
})

check('parent recipient type targets parent_phone and is tagged', () => {
  const messages = buildBulkMessages([{ ...RECIPIENTS[0], phone: RECIPIENTS[0].parent_phone }], 'ولي أمر {{student_name}}', { lang: 'ar', recipientType: 'parent' })
  assert.equal(messages[0].phone, '201198765432')
  assert.equal(messages[0].target, 'parent')
})

check('desktop vs mobile dispatch URLs differ by platform host', () => {
  const [m] = buildBulkMessages([RECIPIENTS[0]], 'hi', { lang: 'en' })
  // buildChatUrl defaults to isMobileDevice(): false in Node => desktop host
  assert.match(m.url, /^https:\/\/web\.whatsapp\.com\//)
})

/* ------------------------------------------------------------------ */
console.log(`\n${passed} checks passed\n`)

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const schema = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8')
const envExample = readFileSync(new URL('../.env.example', import.meta.url), 'utf8')
const gatewayClient = readFileSync(new URL('../src/lib/whatsappGateway.js', import.meta.url), 'utf8')
const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'))
const subpointsSql = readFileSync(new URL('../homework-subpoints.sql', import.meta.url), 'utf8')
const featuresSql = readFileSync(new URL('../migration-features.sql', import.meta.url), 'utf8')
const apiClient = readFileSync(new URL('../src/lib/api.js', import.meta.url), 'utf8')

const checks = [
  ['lesson reads go through a redacted view', () => {
    assert.match(schema, /VIEW public\.lesson_catalog/)
    assert.match(schema, /strip_assessment_answers/)
    assert.doesNotMatch(schema, /CREATE POLICY "lessons: read"/)
  }],
  ['homework reads hide keys and gate explanation URLs', () => {
    assert.match(schema, /VIEW public\.homework_catalog/)
    assert.match(schema, /s\.status = 'graded'/)
    assert.doesNotMatch(schema, /CREATE POLICY "assignments: read published"/)
  }],
  ['lesson homework writes are RPC-only', () => {
    assert.doesNotMatch(schema, /CREATE POLICY "homework_submissions: insert own"/)
    assert.doesNotMatch(schema, /CREATE POLICY "homework_submissions: update own"/)
  }],
  ['submission storage is private and allowlisted', () => {
    assert.match(schema, /'submissions', 'submissions', false/)
    assert.match(schema, /file_size_limit/)
    assert.match(schema, /storage\.foldername\(name\).*auth\.uid/s)
  }],
  ['browser configuration contains no gateway or webhook secret', () => {
    assert.doesNotMatch(envExample, /VITE_WHATSAPP_API_KEY|VITE_WHATSAPP_WEBHOOK_URL/)
    assert.doesNotMatch(gatewayClient, /VITE_WHATSAPP_API_KEY|x-api-key/)
    assert.match(gatewayClient, /access_token/)
  }],
  ['deployment defines a CSP and HSTS', () => {
    const headers = vercel.headers.flatMap((entry) => entry.headers)
    assert.ok(headers.some((header) => header.key === 'Content-Security-Policy'))
    assert.ok(headers.some((header) => header.key === 'Strict-Transport-Security'))
  }],

  /* ---------------- nested MCQ subpoints ---------------- */
  ['subpoint answer keys are redacted for students (both copies)', () => {
    for (const file of [schema, subpointsSql]) {
      assert.match(file, /jsonb_array_elements\(item -> 'subpoints'\)/)
      assert.match(file, /sp - 'answer' - 'correctAnswer'/)
    }
  }],
  ['admin answer editing is authorized in the database, not the UI', () => {
    assert.match(subpointsSql, /FUNCTION public\.admin_update_submission_answer/)
    assert.match(subpointsSql, /IF NOT public\.is_admin\(\) THEN\s+RAISE EXCEPTION 'Only administrators can edit submitted answers'/)
    assert.match(subpointsSql, /REVOKE ALL ON FUNCTION public\.admin_update_submission_answer\(UUID, TEXT, TEXT, TEXT\) FROM PUBLIC, anon/)
    assert.match(subpointsSql, /GRANT EXECUTE ON FUNCTION public\.admin_update_submission_answer\(UUID, TEXT, TEXT, TEXT\) TO authenticated/)
  }],
  ['an answer edit re-grades instead of accepting a client score', () => {
    assert.match(subpointsSql, /SELECT \* INTO m FROM public\.ph_mark_answers\(v_questions, v_answers\)/)
    // The client posts only an answer — never a score or a percentage.
    assert.doesNotMatch(apiClient, /admin_update_submission_answer[\s\S]{0,400}p_score/)
  }],
  ['answers are addressed by stable id, never by array index', () => {
    assert.match(subpointsSql, /WHERE COALESCE\(item ->> 'id', ''\) = v_sp_id/)
    assert.match(subpointsSql, /RAISE EXCEPTION 'Subpoint % is not part of question %'/)
  }],
  ['the answer audit trail is admin-readable and append-only', () => {
    assert.match(subpointsSql, /CREATE TABLE IF NOT EXISTS public\.submission_answer_edits/)
    assert.match(subpointsSql, /ENABLE ROW LEVEL SECURITY/)
    assert.match(subpointsSql, /"submission_answer_edits: admin read"[\s\S]*?USING \(public\.is_admin\(\)\)/)
    assert.match(subpointsSql, /BEFORE UPDATE OR DELETE ON public\.submission_answer_edits/)
    // No write policy: the SECURITY DEFINER RPC is the only writer.
    assert.doesNotMatch(subpointsSql, /POLICY "submission_answer_edits: (admin )?(write|insert|update|delete|all)"/i)
    assert.match(subpointsSql, /REVOKE ALL ON public\.submission_answer_edits FROM PUBLIC, anon/)
  }],
  ['subpoint marking never double-counts the parent question', () => {
    assert.match(subpointsSql, /total_points := total_points \+ sp_points/)
    assert.doesNotMatch(subpointsSql, /total_points := total_points \+ q_points;\s*\n\s*IF NOT sp_answered/)
  }],

  /* ---------------- admin password management ---------------- */
  ['admin password change is server-side and admin-gated', () => {
    assert.match(featuresSql, /FUNCTION public\.admin_set_student_password/)
    assert.match(featuresSql, /IF NOT public\.is_admin\(\) THEN\s+RAISE EXCEPTION 'Only administrators can set passwords'/)
    assert.match(featuresSql, /REVOKE ALL ON FUNCTION public\.admin_set_student_password\(UUID, TEXT\) FROM PUBLIC, anon/)
  }],
  ['passwords are only ever hashed, never stored or returned', () => {
    assert.match(featuresSql, /crypt\(new_password, gen_salt\('bf'\)\)/)
    assert.doesNotMatch(featuresSql, /RETURN[^\n]*new_password/)
    // No plaintext password column anywhere in the schema.
    assert.doesNotMatch(schema, /ALTER TABLE public\.profiles ADD COLUMN IF NOT EXISTS password/i)
    // The browser never holds a service-role key.
    assert.doesNotMatch(envExample, /SERVICE_ROLE/)
    assert.doesNotMatch(apiClient, /service_role|SERVICE_ROLE/)
  }],
]

console.log('\nSecurity regression checks\n')
for (const [name, check] of checks) {
  check()
  console.log(`  ✓ ${name}`)
}
console.log(`\n${checks.length} checks passed\n`)

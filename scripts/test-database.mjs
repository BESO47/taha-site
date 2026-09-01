/**
 * =====================================================================
 * DATABASE REGRESSION TESTS — runs the project's real SQL migrations
 * against a disposable PostgreSQL instance and exercises the RPCs.
 * ---------------------------------------------------------------------
 * This is the only check that actually EXECUTES schema.sql,
 * homework-grading.sql, migration-features.sql and homework-subpoints.sql
 * instead of reading them, so it is what proves that:
 *
 *   • the migrations apply cleanly, in order, on a fresh database,
 *   • nested MCQ subpoints are marked independently and never
 *     double-count the parent question's points,
 *   • flat (pre-subpoint) homework and submissions still mark the same,
 *   • `strip_assessment_answers` hides subpoint answer keys from students,
 *   • `admin_update_submission_answer` re-grades and writes an audit row,
 *   • a STUDENT calling that RPC is rejected with an authorization error,
 *   • the audit history is append-only.
 *
 * It needs the optional `embedded-postgres` dev tool. Without it the
 * suite reports a skip and exits 0, so `npm test` still passes on a
 * machine that has not installed it:
 *
 *     npm i -D --no-save embedded-postgres
 *     npm run test:database
 * =====================================================================
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const sql = (file) => readFileSync(join(here, '..', file), 'utf8')

let EmbeddedPostgres
try {
  ;({ default: EmbeddedPostgres } = await import('embedded-postgres'))
} catch {
  console.log('\nDatabase regression tests\n')
  console.log('  - skipped: `embedded-postgres` is not installed')
  console.log('    install it with:  npm i -D --no-save embedded-postgres\n')
  process.exit(0)
}

/* ------------------------------------------------------------------ */
/* Minimal stand-ins for the Supabase-only pieces the schema expects.  */
/* ------------------------------------------------------------------ */
const SUPABASE_STUBS = `
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email               TEXT UNIQUE,
  encrypted_password  TEXT,
  email_confirmed_at  TIMESTAMPTZ,
  raw_user_meta_data  JSONB DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID
$$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS TEXT
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.role', true), '')
$$;
GRANT EXECUTE ON FUNCTION auth.uid()  TO PUBLIC;
GRANT EXECUTE ON FUNCTION auth.role() TO PUBLIC;

CREATE SCHEMA IF NOT EXISTS storage;
CREATE TABLE IF NOT EXISTS storage.buckets (
  id TEXT PRIMARY KEY, name TEXT, public BOOLEAN DEFAULT false,
  file_size_limit BIGINT, allowed_mime_types TEXT[]
);
CREATE TABLE IF NOT EXISTS storage.objects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id TEXT, name TEXT, owner UUID, metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION storage.foldername(name TEXT) RETURNS TEXT[]
LANGUAGE sql IMMUTABLE AS $$ SELECT string_to_array(name, '/') $$;
CREATE OR REPLACE FUNCTION storage.extension(name TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$ SELECT reverse(split_part(reverse(name), '.', 1)) $$;

DO $$ BEGIN CREATE ROLE anon            NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated   NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role    NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticator   LOGIN;   EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT anon, authenticated, service_role TO authenticator;
`

/** Act as a JWT principal (or as nobody) for the next statements. */
const actingAs = (client, sub, role) => async () => {
  await client.query(`SELECT set_config('request.jwt.claim.sub', ${sub ? `'${sub}'` : "''"}, false)`)
  await client.query(`SELECT set_config('request.jwt.claim.role', ${role ? `'${role}'` : "''"}, false)`)
  if (role) await client.query(`SET ROLE ${role}`)
  else await client.query('RESET ROLE')
}

const dataDir = mkdtempSync(join(tmpdir(), 'physics-hub-pg-'))
const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: 'postgres',
  password: 'postgres',
  port: 55432,
  persistent: false,
  onLog: () => {},
})

let passed = 0
let client = null
const check = async (name, fn) => {
  await fn()
  passed++
  console.log(`  ✓ ${name}`)
}

console.log('\nDatabase migrations, RPCs and RLS (live PostgreSQL)\n')

try {
  await pg.initialise()
  await pg.start()
  client = await pg.getPgClient()
  client.on('error', () => {}) // the shutdown at the end is expected
  await client.connect()

  /* ---------- 1. the real migrations, in the documented order -------- */
  await client.query(SUPABASE_STUBS)
  for (const file of ['schema.sql', 'homework-grading.sql', 'migration-features.sql', 'homework-subpoints.sql']) {
    await client.query(sql(file))
  }
  console.log('  · applied schema.sql, homework-grading.sql, migration-features.sql, homework-subpoints.sql')

  // Re-running must be safe: every migration is documented as idempotent.
  await client.query(sql('homework-subpoints.sql'))
  console.log('  · homework-subpoints.sql re-applied cleanly (idempotent)')

  // Supabase grants table access to the API roles; RLS then decides which
  // rows they see. Function EXECUTE is deliberately NOT blanket-granted
  // here, so the per-RPC `REVOKE ... FROM PUBLIC, anon` statements in the
  // migrations stay in force and the authorization tests stay honest.
  await client.query(`
    GRANT USAGE ON SCHEMA public, auth, storage TO anon, authenticated;
    GRANT ALL ON ALL TABLES    IN SCHEMA public TO anon, authenticated;
    GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
  `)

  /* ---------- 2. fixtures -------------------------------------------
   * Sign the three users up through auth.users so the real
   * `handle_new_auth_user()` trigger creates their profiles — the same
   * path production registration takes.
   * ------------------------------------------------------------------ */
  const ADMIN = 'aaaaaaaa-0000-0000-0000-000000000001'
  const STU_A = 'bbbbbbbb-0000-0000-0000-000000000001'
  const STU_B = 'bbbbbbbb-0000-0000-0000-000000000002'

  const signUp = (id, email, fullName, phone) => client.query(
    `INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data)
     VALUES ($1, $2, crypt('InitialPass1', gen_salt('bf')), now(),
             jsonb_build_object('full_name', $3::text, 'phone', $4::text, 'year_id', '5'))`,
    [id, email, fullName, phone]
  )
  await signUp(ADMIN, 'admin@x.test', 'Admin', '01000000001')
  await signUp(STU_A, 'a@x.test', 'Student A', '01000000002')
  await signUp(STU_B, 'b@x.test', 'Student B', '01000000003')

  const { rows: profiles } = await client.query(
    `SELECT id, full_name, role FROM public.profiles ORDER BY full_name`
  )
  assert.equal(profiles.length, 3, 'the signup trigger created all three profiles')
  assert.ok(profiles.every((p) => p.role === 'student'), 'every signup starts as a student')

  await client.query(`UPDATE public.profiles SET role = 'admin' WHERE id = $1`, [ADMIN])

  // A homework entry mixing a flat question with a three-subpoint question.
  const QUESTIONS = [
    { id: 'q1', question: 'SI unit of current?', options: ['A) Ampere', 'B) Volt', 'C) Ohm', 'D) Joule'], answer: 'A', points: 2 },
    {
      id: 'q2',
      question: 'Choose the correct answer for each of the following:',
      points: 99, // deliberately wrong on purpose: must be IGNORED when subpoints exist
      subpoints: [
        { id: 'sp_a', question: "Newton's first law?", options: ['A) w', 'B) x', 'C) y', 'D) z'], answer: 'B', points: 1 },
        { id: 'sp_b', question: 'What is inertia?', options: ['A) w', 'B) x', 'C) y', 'D) z'], answer: 'C', points: 1 },
        { id: 'sp_c', question: 'Net force zero?', options: ['A) w', 'B) x', 'C) y', 'D) z'], answer: 'A', points: 1 },
      ],
    },
  ]
  const { rows: [{ id: ASSIGNMENT }] } = await client.query(
    `INSERT INTO public.assignments (title, year_id, is_published, questions, total_points, created_by)
     VALUES ('Nested MCQ homework','5',true,$1::jsonb,5,$2) RETURNING id`,
    [JSON.stringify(QUESTIONS), ADMIN]
  )

  // A legacy entry with no subpoints at all.
  const LEGACY = [
    { id: 'q1', question: 'Unit?', options: ['A) Ampere', 'B) Volt'], answer: 'A', points: 5 },
    { id: 'q2', question: 'Unit?', options: ['A) Ampere', 'B) Volt'], answer: 'B', points: 5 },
  ]
  const { rows: [{ id: LEGACY_ASSIGNMENT }] } = await client.query(
    `INSERT INTO public.assignments (title, year_id, is_published, questions, total_points, created_by)
     VALUES ('Legacy flat homework','5',true,$1::jsonb,10,$2) RETURNING id`,
    [JSON.stringify(LEGACY), ADMIN]
  )

  /* ---------- 3. subpoint marking ------------------------------------ */
  await check('ph_mark_answers grades every subpoint independently', async () => {
    const { rows: [r] } = await client.query(
      `SELECT * FROM public.ph_mark_answers($1::jsonb, $2::jsonb)`,
      [JSON.stringify(QUESTIONS), JSON.stringify({
        q1: 'A',
        q2: { answer: '', subpoints: { sp_a: 'B', sp_b: 'A', sp_c: 'A' } },
      })]
    )
    assert.equal(Number(r.correct_count), 3, 'q1 + sp_a + sp_c are correct')
    assert.equal(Number(r.incorrect_count), 1, 'sp_b is wrong')
    assert.equal(Number(r.score), 4)
    assert.equal(Number(r.total_points), 5, 'parent points (99) must be ignored')
    assert.equal(Number(r.percentage), 80)
  })

  await check('subpoint answers keyed by roman numeral label also resolve', async () => {
    const { rows: [r] } = await client.query(
      `SELECT * FROM public.ph_mark_answers($1::jsonb, $2::jsonb)`,
      [JSON.stringify(QUESTIONS), JSON.stringify({ q2: { subpoints: { i: 'B', ii: 'C', iii: 'A' } } })]
    )
    assert.equal(Number(r.correct_count), 3)
  })

  await check('legacy flat subpoint keys ("q2.sp_a") still grade', async () => {
    const { rows: [r] } = await client.query(
      `SELECT * FROM public.ph_mark_answers($1::jsonb, $2::jsonb)`,
      [JSON.stringify(QUESTIONS), JSON.stringify({ q1: 'A', 'q2.sp_a': 'B', 'q2.sp_b': 'C', 'q2.sp_c': 'A' })]
    )
    assert.equal(Number(r.correct_count), 4)
    assert.equal(Number(r.percentage), 100)
  })

  await check('breakdown carries per-subpoint labels and marks', async () => {
    const { rows: [r] } = await client.query(
      `SELECT * FROM public.ph_mark_answers($1::jsonb, $2::jsonb)`,
      [JSON.stringify(QUESTIONS), JSON.stringify({ q2: { subpoints: { sp_a: 'B', sp_b: 'A', sp_c: 'A' } } })]
    )
    const q2 = r.breakdown[1]
    assert.equal(q2.hasSubpoints, true)
    assert.deepEqual(q2.subpoints.map((s) => s.label), ['i', 'ii', 'iii'])
    assert.deepEqual(q2.subpoints.map((s) => s.isCorrect), [true, false, true])
    assert.equal(q2.subpoints[1].correctAnswer, 'C')
    assert.equal(Number(q2.points), 3)
    assert.equal(Number(q2.earnedPoints), 2)
    assert.equal(q2.isCorrect, false, 'parent is correct only when all subpoints are')
  })

  await check('deleting a subpoint re-numbers the survivors from storage', async () => {
    const trimmed = [{ ...QUESTIONS[1], subpoints: [QUESTIONS[1].subpoints[0], QUESTIONS[1].subpoints[2]] }]
    const { rows: [r] } = await client.query(
      `SELECT * FROM public.ph_mark_answers($1::jsonb, $2::jsonb)`,
      [JSON.stringify(trimmed), JSON.stringify({ q2: { subpoints: { sp_a: 'B', sp_c: 'A' } } })]
    )
    assert.deepEqual(r.breakdown[0].subpoints.map((s) => s.label), ['i', 'ii'])
    assert.deepEqual(r.breakdown[0].subpoints.map((s) => s.subpointId), ['sp_a', 'sp_c'])
  })

  await check('homework without subpoints marks exactly as before', async () => {
    const { rows: [r] } = await client.query(
      `SELECT * FROM public.ph_mark_answers($1::jsonb, $2::jsonb)`,
      [JSON.stringify(LEGACY), JSON.stringify({ q1: 'A', q2: 'A' })]
    )
    assert.equal(Number(r.correct_count), 1)
    assert.equal(Number(r.score), 5)
    assert.equal(Number(r.total_points), 10)
    assert.equal(Number(r.percentage), 50)
    assert.equal(r.breakdown[0].hasSubpoints, false)
  })

  /* ---------- 4. answer-key protection ------------------------------- */
  await check('strip_assessment_answers hides subpoint keys from students', async () => {
    const { rows: [r] } = await client.query(
      `SELECT public.strip_assessment_answers($1::jsonb) AS redacted`,
      [JSON.stringify(QUESTIONS)]
    )
    const text = JSON.stringify(r.redacted)
    assert.equal(r.redacted[0].answer, undefined)
    assert.equal(r.redacted[1].subpoints.length, 3, 'subpoints themselves stay visible')
    assert.ok(!/correctAnswer|"answer"/.test(text), `no answer key leaked: ${text}`)
    assert.equal(r.redacted[1].subpoints[0].options.length, 4, 'options stay visible')
  })

  await check('homework_catalog leaks no subpoint key to a student', async () => {
    await actingAs(client, STU_A, 'authenticated')()
    const { rows } = await client.query(
      `SELECT questions FROM public.homework_catalog WHERE id = $1`, [ASSIGNMENT]
    )
    assert.equal(rows.length, 1, 'student can see the published homework')
    const text = JSON.stringify(rows[0].questions)
    assert.ok(!/"answer"\s*:/.test(text), `answer key must not reach the client: ${text}`)
    await actingAs(client, null, null)()
  })

  /* ---------- 5. student submits, server grades ---------------------- */
  let submissionId
  await check('grade_assignment_submission stores the nested structure', async () => {
    await actingAs(client, STU_A, 'authenticated')()
    const { rows: [r] } = await client.query(
      `SELECT * FROM public.grade_assignment_submission($1, $2::jsonb)`,
      [ASSIGNMENT, JSON.stringify({ q1: 'A', q2: { answer: '', subpoints: { sp_a: 'B', sp_b: 'A', sp_c: 'A' } } })]
    )
    assert.equal(Number(r.correct_count), 3)
    assert.equal(Number(r.score), 4)
    assert.equal(Number(r.percentage), 80)

    const { rows: [sub] } = await client.query(
      `SELECT id, answers, status, score, percentage FROM public.submissions WHERE student_id = $1`, [STU_A]
    )
    submissionId = sub.id
    assert.equal(sub.answers.q2.subpoints.sp_b, 'A')
    assert.equal(sub.status, 'graded')
    assert.equal(Number(sub.score), 4)
    await actingAs(client, null, null)()
  })

  /* ---------- 6. admin answer editing -------------------------------- */
  await check('a student CANNOT call admin_update_submission_answer', async () => {
    await actingAs(client, STU_A, 'authenticated')()
    await assert.rejects(
      client.query(
        `SELECT public.admin_update_submission_answer($1,'q2','sp_b','C')`, [submissionId]
      ),
      /Only administrators can edit submitted answers/
    )
    await actingAs(client, null, null)()

    const { rows: [sub] } = await client.query(
      `SELECT answers FROM public.submissions WHERE id = $1`, [submissionId]
    )
    assert.equal(sub.answers.q2.subpoints.sp_b, 'A', 'the rejected call changed nothing')
  })

  await check('an unauthenticated caller cannot even invoke the RPC', async () => {
    // Two independent layers: `REVOKE ALL ... FROM PUBLIC, anon` in the
    // migration stops anon at the GRANT level, and the function body
    // re-checks auth.uid() for anyone who does hold EXECUTE.
    await actingAs(client, null, 'anon')()
    await assert.rejects(
      client.query(`SELECT public.admin_update_submission_answer($1,'q2','sp_b','C')`, [submissionId]),
      /permission denied for function|Not authenticated/
    )
    await actingAs(client, null, null)()

    // The function's ACL, as it would exist after running the migration on
    // a real project: EXECUTE for `authenticated` only — never PUBLIC, anon
    // or service_role-by-default. In an aclitem the grantee comes before
    // the '=', so an entry starting with '=' means PUBLIC.
    const { rows: [fn] } = await client.query(
      `SELECT proacl
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'admin_update_submission_answer'`
    )
    const acl = Array.isArray(fn.proacl) ? fn.proacl : String(fn.proacl).replace(/^\{|\}$/g, '').split(',')
    assert.ok(acl.some((e) => e.startsWith('authenticated=X/')), `authenticated may execute: ${acl}`)
    assert.ok(!acl.some((e) => e.startsWith('=')), `PUBLIC must not hold EXECUTE: ${acl}`)
    assert.ok(!acl.some((e) => e.startsWith('anon=X/')), `anon must not hold EXECUTE: ${acl}`)
  })

  await check('admin edits ONE subpoint, is re-graded and audited', async () => {
    await actingAs(client, ADMIN, 'authenticated')()
    const { rows: [r] } = await client.query(
      `SELECT public.admin_update_submission_answer($1,'q2','sp_b','C') AS res`, [submissionId]
    )
    assert.equal(r.res.ok, true)
    assert.equal(r.res.previous_answer, 'A')
    assert.equal(r.res.new_answer, 'C')
    assert.equal(Number(r.res.correct_count), 4)
    assert.equal(Number(r.res.score), 5)
    assert.equal(Number(r.res.percentage), 100)

    const { rows: [sub] } = await client.query(
      `SELECT answers, score, percentage, status FROM public.submissions WHERE id = $1`, [submissionId]
    )
    assert.equal(sub.answers.q2.subpoints.sp_b, 'C', 'the edit persisted')
    assert.equal(sub.answers.q2.subpoints.sp_a, 'B', 'unrelated answers untouched')
    assert.equal(sub.answers.q1, 'A', 'flat answers untouched')
    assert.equal(Number(sub.score), 5)
    assert.equal(sub.status, 'graded')

    const { rows: edits } = await client.query(
      `SELECT question_id, subpoint_id, previous_answer, new_answer, changed_by,
              score_before, score_after
         FROM public.submission_answer_edits WHERE submission_id = $1`, [submissionId]
    )
    assert.equal(edits.length, 1)
    assert.equal(edits[0].subpoint_id, 'sp_b')
    assert.equal(edits[0].previous_answer, 'A')
    assert.equal(edits[0].new_answer, 'C')
    assert.equal(edits[0].changed_by, ADMIN)
    assert.equal(Number(edits[0].score_before), 4)
    assert.equal(Number(edits[0].score_after), 5)
    await actingAs(client, null, null)()
  })

  await check('admin edits a flat (non-subpoint) answer the same way', async () => {
    await actingAs(client, ADMIN, 'authenticated')()
    const { rows: [r] } = await client.query(
      `SELECT public.admin_update_submission_answer($1,'q1',NULL,'B') AS res`, [submissionId]
    )
    assert.equal(r.res.previous_answer, 'A')
    assert.equal(Number(r.res.score), 3, 'q1 was worth 2 points and is now wrong')
    assert.equal(Number(r.res.incorrect_count), 1)
    await actingAs(client, null, null)()
  })

  await check('an answer that is not one of the options is refused', async () => {
    await actingAs(client, ADMIN, 'authenticated')()
    await assert.rejects(
      client.query(`SELECT public.admin_update_submission_answer($1,'q2','sp_a','Q')`, [submissionId]),
      /one of the available options/
    )
    await actingAs(client, null, null)()
  })

  await check('an unknown subpoint id is refused (no index guessing)', async () => {
    await actingAs(client, ADMIN, 'authenticated')()
    await assert.rejects(
      client.query(`SELECT public.admin_update_submission_answer($1,'q2','sp_zzz','A')`, [submissionId]),
      /is not part of question/
    )
    await actingAs(client, null, null)()
  })

  await check('the audit history cannot be rewritten or erased', async () => {
    const before = async () => {
      const { rows } = await client.query(
        `SELECT id, new_answer, previous_answer FROM public.submission_answer_edits ORDER BY created_at`
      )
      return rows
    }
    const snapshot = await before()
    assert.ok(snapshot.length >= 2, 'the two edits above are recorded')

    // Layer 1 — RLS. `authenticated` has no UPDATE/DELETE policy, so both
    // statements match zero rows and change nothing (no error, no write).
    await actingAs(client, ADMIN, 'authenticated')()
    const upd = await client.query(`UPDATE public.submission_answer_edits SET new_answer = 'D'`)
    assert.equal(upd.rowCount, 0, 'RLS lets no UPDATE through')
    const del = await client.query(`DELETE FROM public.submission_answer_edits`)
    assert.equal(del.rowCount, 0, 'RLS lets no DELETE through')
    await actingAs(client, null, null)()
    assert.deepEqual(await before(), snapshot, 'the recorded history is unchanged')

    // Layer 2 — the immutability trigger, which also covers a caller that
    // bypasses RLS (table owner / superuser).
    await assert.rejects(
      client.query(`UPDATE public.submission_answer_edits SET new_answer = 'D'`),
      /append-only/
    )
    await assert.rejects(
      client.query(`DELETE FROM public.submission_answer_edits`),
      /append-only/
    )
    assert.deepEqual(await before(), snapshot, 'still unchanged after the blocked owner-level attempt')
  })

  await check('a student cannot read the audit history', async () => {
    await actingAs(client, STU_A, 'authenticated')()
    const { rows } = await client.query(`SELECT * FROM public.submission_answer_edits`)
    assert.equal(rows.length, 0, 'RLS hides every row from a student')
    await actingAs(client, null, null)()
  })

  /* ---------- 7. an ungraded paper stays ungraded -------------------- */
  await check('editing an answer key-less submission does not mark it graded', async () => {
    const KEYLESS = [{ id: 'q1', question: 'Explain in your own words', options: [], answer: '', points: 5 }]
    const { rows: [{ id: keylessId }] } = await client.query(
      `INSERT INTO public.assignments (title, year_id, is_published, questions, created_by)
       VALUES ('Essay homework','5',true,$1::jsonb,$2) RETURNING id`,
      [JSON.stringify(KEYLESS), ADMIN]
    )
    await actingAs(client, STU_B, 'authenticated')()
    await client.query(
      `INSERT INTO public.submissions (assignment_id, student_id, content, status)
       VALUES ($1,$2,'My essay','submitted')`,
      [keylessId, STU_B]
    )
    const { rows: [sub] } = await client.query(
      `SELECT id FROM public.submissions WHERE assignment_id = $1`, [keylessId]
    )
    await actingAs(client, null, null)()

    await actingAs(client, ADMIN, 'authenticated')()
    const { rows: [r] } = await client.query(
      `SELECT public.admin_update_submission_answer($1,'q1',NULL,'Teacher note') AS res`, [sub.id]
    )
    assert.equal(r.res.status, 'submitted', 'no answer key -> still "submitted"')
    assert.equal(r.res.new_answer, 'Teacher note')
    await actingAs(client, null, null)()
  })

  /* ---------- 8. admin password reset -------------------------------- */
  await check('admin_set_student_password hashes into auth.users', async () => {
    await actingAs(client, ADMIN, 'authenticated')()
    const { rows: [r] } = await client.query(
      `SELECT public.admin_set_student_password($1,'BrandNewPass1') AS res`, [STU_A]
    )
    assert.equal(r.res.ok, true)
    await actingAs(client, null, null)()

    const { rows: [u] } = await client.query(`SELECT encrypted_password FROM auth.users WHERE id = $1`, [STU_A])
    assert.match(u.encrypted_password, /^\$2[aby]\$/, 'stored as a bcrypt hash, never plaintext')
    assert.ok(!u.encrypted_password.includes('BrandNewPass1'))
    const { rows: [{ ok }] } = await client.query(
      `SELECT (encrypted_password = crypt('BrandNewPass1', encrypted_password)) AS ok
         FROM auth.users WHERE id = $1`, [STU_A]
    )
    assert.equal(ok, true, 'the student can log in with the new password')
  })

  await check('a student cannot reset another student password', async () => {
    await actingAs(client, STU_A, 'authenticated')()
    await assert.rejects(
      client.query(`SELECT public.admin_set_student_password($1,'Hacked12345')`, [STU_B]),
      /Only administrators can set passwords/
    )
    await actingAs(client, null, null)()
  })

  await check('no password column exists on profiles', async () => {
    const { rows } = await client.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'profiles'
          AND column_name ILIKE '%password%'`
    )
    assert.equal(rows.length, 0)
  })

  console.log(`\n${passed} checks passed\n`)
} catch (err) {
  console.error(`\n✗ ${err.message}`)
  const frame = (err.stack || '').split('\n').find((l) => l.includes('test-database.mjs'))
  if (frame) console.error(`  ${frame.trim()}`)
  console.log('')
  process.exitCode = 1
} finally {
  try { await client?.end() } catch {}
  try { await pg.stop() } catch {}
  rmSync(dataDir, { recursive: true, force: true })
}

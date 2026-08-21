import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const schema = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8')
const envExample = readFileSync(new URL('../.env.example', import.meta.url), 'utf8')
const gatewayClient = readFileSync(new URL('../src/lib/whatsappGateway.js', import.meta.url), 'utf8')
const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'))

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
]

console.log('\nSecurity regression checks\n')
for (const [name, check] of checks) {
  check()
  console.log(`  ✓ ${name}`)
}
console.log(`\n${checks.length} checks passed\n`)

/**
 * Test fixture: the real data layer, with the registration group reader
 * replaced by one that fails the way a broken backend does (RLS error,
 * missing migration, network outage).
 *
 * Used by scripts/test-ui.mjs to prove the signup page REPORTS the
 * failure instead of rendering an empty group list.
 */
export * from '../../src/lib/api.js'

export async function fetchRegistrationGroups() {
  const error = new Error('Unable to load groups: backend unavailable')
  error.code = 'MISSING_MIGRATION'
  throw error
}

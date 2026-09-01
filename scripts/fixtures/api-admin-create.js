/**
 * Test fixture: the real data layer, with the admin student-creation call
 * replaced by a spy, and the reads StudentsTab performs on mount stubbed
 * so the tab renders deterministically with no backend.
 *
 * Used by scripts/test-ui.mjs to prove the admin "Add Student" dialog
 * validates its input and posts exactly the fields the signup form
 * collects.
 */
export * from '../../src/lib/api.js'

export const createCalls = []

export async function fetchGroups() {
  return [
    { id: 'grp-5a', name: 'Group A (2nd Sec)', year_id: '5' },
    { id: 'grp-6a', name: 'Group A (3rd Sec)', year_id: '6' },
  ]
}

export async function fetchStudentsPaginated() {
  return { data: [], total: 0, page: 1, pageSize: 20, totalPages: 1 }
}

export async function adminCreateStudent(payload) {
  createCalls.push(payload)
  return {
    id: 'new-student',
    full_name: payload.fullName,
    email: payload.email,
    year_id: payload.yearId,
    group_id: payload.groupId,
    is_active: payload.isActive,
    role: 'student',
  }
}

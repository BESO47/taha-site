import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Users, Search, Loader2, TrendingUp, X, Plus, Trash2, Tag, Check, Layers,
  ClipboardList, Edit3, Lock, ChevronLeft, ChevronRight, CheckSquare, Square,
  AlertTriangle, RefreshCw, UserCheck, UserX, Mail, Phone, MapPin, Calendar,
  UserPlus, Eye, EyeOff, Copy,
} from 'lucide-react'
import { useLanguage } from '../../lib/i18n.jsx'
import { YEARS, GOVERNORATES } from '../../data/catalog'
import { supabase } from '../../lib/supabase'
import {
  fetchStudentAnalytics, fetchGradesForStudent, fetchAttendanceForStudent,
  fetchGroups, createGroup, deleteGroup, updateStudentGroup,
  fetchHomeworkEntries, fetchSubmissionsForStudent,
  fetchStudentsPaginated, adminCreateStudent, adminUpdateStudent, adminSetStudentPassword,
  bulkUpdateStudentGroup, bulkUpdateStudentStatus,
  cancelAttendance,
} from '../../lib/api'
import { normalizePhone, validatePhone } from '../../lib/whatsapp'
import WhatsAppReportButton from '../WhatsAppReportButton.jsx'
import GroupFilterSelect, { getInitialGroupFilter } from './GroupFilterSelect.jsx'

function Bar({ value, color = 'bg-yellow-400' }) {
  const v = Math.max(0, Math.min(100, Number(value) || 0))
  return (
    <div className="h-1.5 w-full rounded-full bg-slate-200 dark:bg-zinc-800 overflow-hidden">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${v}%` }} />
    </div>
  )
}

const PAGE_SIZE = 20

export default function StudentsTab({ students = [], analytics = [], onRefresh }) {
  const { t, lang } = useLanguage()
  const [search, setSearch] = useState('')
  const [yearFilter, setYearFilter] = useState('all')
  const [groupId, setGroupId] = useState(() => getInitialGroupFilter())
  const [statusFilter, setStatusFilter] = useState('all') // all | active | suspended

  // Group Management State
  const [groups, setGroups] = useState([])
  const selectedGroupName = groups?.find((g) => g.id === groupId)?.name || null
  const [showManageGroups, setShowManageGroups] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')
  const [newGroupYear, setNewGroupYear] = useState('5')
  const [addingGroup, setAddingGroup] = useState(false)
  const [successMsg, setSuccessMsg] = useState('')

  // Pagination
  const [page, setPage] = useState(1)
  const [paginatedData, setPaginatedData] = useState(null)
  const [loadingPage, setLoadingPage] = useState(false)

  // Bulk Selection
  const [selected, setSelected] = useState(new Set())

  // Create Student (admin-made account)
  const EMPTY_NEW_STUDENT = {
    fullName: '', email: '', password: '', confirmPassword: '',
    phone: '', parentPhone: '', yearId: '5', groupId: '',
    governorate: GOVERNORATES[0], isActive: true,
  }
  const [showCreate, setShowCreate] = useState(false)
  const [createForm, setCreateForm] = useState(EMPTY_NEW_STUDENT)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')
  const [showCreatePassword, setShowCreatePassword] = useState(false)
  const [createdStudent, setCreatedStudent] = useState(null)

  // Detail / Edit / Password Modals
  const [detail, setDetail] = useState(null)
  const [detailData, setDetailData] = useState(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [editing, setEditing] = useState(null)
  const [editForm, setEditForm] = useState({})
  const [savingEdit, setSavingEdit] = useState(false)
  const [passwordModal, setPasswordModal] = useState(null)
  const [newPassword, setNewPassword] = useState('')
  const [confirmNewPassword, setConfirmNewPassword] = useState('')
  const [changingPassword, setChangingPassword] = useState(false)
  const [passwordError, setPasswordError] = useState('')

  // Bulk Action Modal
  const [bulkAction, setBulkAction] = useState(null) // 'group' | 'activate' | 'suspend'
  const [bulkGroupId, setBulkGroupId] = useState('')
  const [bulkSaving, setBulkSaving] = useState(false)

  // Attendance Cancel
  const [cancellingAttendance, setCancellingAttendance] = useState(null)

  const [groupsError, setGroupsError] = useState('')

  const loadGroups = useCallback(async () => {
    try {
      setGroupsError('')
      const g = await fetchGroups()
      setGroups(g)
    } catch (err) {
      console.error('Error loading groups:', err)
      setGroupsError(err.message || 'Unable to load groups.')
    }
  }, [])

  useEffect(() => { loadGroups() }, [loadGroups])

  const analyticsFor = useCallback(
    (id) => analytics.find((a) => a.student_id === id) || {},
    [analytics]
  )

  // Server-side paginated student loading
  const loadPage = useCallback(async () => {
    setLoadingPage(true)
    try {
      const result = await fetchStudentsPaginated({
        page,
        pageSize: PAGE_SIZE,
        search: search || null,
        yearId: yearFilter !== 'all' ? yearFilter : null,
        groupId: groupId !== 'all' && groupId !== 'none' ? groupId : null,
        isActive: statusFilter === 'all' ? null : statusFilter === 'active',
      })
      setPaginatedData(result)
    } catch (err) {
      console.error('Pagination failed:', err)
      // Fallback to client-side
      setPaginatedData({ data: students, total: students.length, page: 1, pageSize: students.length, totalPages: 1 })
    } finally {
      setLoadingPage(false)
    }
  }, [page, search, yearFilter, groupId, statusFilter, students])

  useEffect(() => { loadPage() }, [loadPage])

  // Reset page when filters change
  useEffect(() => { setPage(1) }, [search, yearFilter, groupId, statusFilter])

  const displayedStudents = paginatedData?.data || students
  const totalStudents = paginatedData?.total || students.length
  const totalPages = paginatedData?.totalPages || 1

  const toggleActive = async (s) => {
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ is_active: !s.is_active })
        .eq('id', s.id)
      if (error) throw error
      onRefresh?.()
      loadPage()
    } catch (err) {
      alert(err.message)
    }
  }

  const handleGroupChange = async (studentId, newGroupId) => {
    try {
      const selectedGroup = groups.find((group) => group.id === newGroupId) || null
      await updateStudentGroup(studentId, selectedGroup)
      setSuccessMsg(t('groupUpdatedSuccess'))
      setTimeout(() => setSuccessMsg(''), 3000)
      onRefresh?.()
      loadPage()
    } catch (err) {
      alert(err.message)
    }
  }

  const handleAddGroup = async (e) => {
    e.preventDefault()
    if (!newGroupName.trim()) return
    setAddingGroup(true)
    try {
      await createGroup({ name: newGroupName.trim(), yearId: newGroupYear })
      setNewGroupName('')
      await loadGroups()
    } catch (err) {
      alert(err.message)
    } finally {
      setAddingGroup(false)
    }
  }

  const handleDeleteGroup = async (id) => {
    if (!confirm(lang === 'ar' ? 'حذف هذه المجموعة؟' : 'Delete this group?')) return
    try {
      await deleteGroup(id)
      await loadGroups()
    } catch (err) {
      alert(err.message)
    }
  }

  // Student Detail
  const openDetail = async (s) => {
    setDetail(s)
    setLoadingDetail(true)
    try {
      const [a, g, att, hw, subs] = await Promise.all([
        fetchStudentAnalytics(s.id),
        fetchGradesForStudent(s.id),
        fetchAttendanceForStudent(s.id),
        fetchHomeworkEntries({ yearId: s.year_id }),
        fetchSubmissionsForStudent(s.id),
      ])
      setDetailData({ analytics: a || {}, grades: g, attendance: att, homeworkEntries: hw, homeworkSubmissions: subs })
    } catch (err) {
      console.error(err)
    } finally {
      setLoadingDetail(false)
    }
  }

  // Create Student — the admin fills in exactly what a student fills in
  // on the signup form, and the account is ready to sign in immediately.
  const openCreate = () => {
    setCreateForm({
      ...EMPTY_NEW_STUDENT,
      yearId: yearFilter !== 'all' ? yearFilter : '5',
      groupId: '',
    })
    setCreateError('')
    setCreatedStudent(null)
    setShowCreatePassword(false)
    setShowCreate(true)
  }

  // A group belongs to one grade; offering another grade's group would be
  // refused by the database, so the list follows the chosen grade.
  const createGroupOptions = useMemo(
    () => groups.filter((g) => !g.year_id || String(g.year_id) === String(createForm.yearId)),
    [groups, createForm.yearId]
  )

  const setCreateField = (patch) => setCreateForm((prev) => {
    const next = { ...prev, ...patch }
    // Changing the grade always clears a group that no longer applies.
    if (patch.yearId && patch.yearId !== prev.yearId) next.groupId = ''
    return next
  })

  const validateCreateForm = () => {
    const name = createForm.fullName.trim().replace(/\s+/g, ' ')
    if (name.length < 2 || name.length > 120) {
      return lang === 'ar' ? 'يجب أن يكون الاسم بين حرفين و120 حرفاً.' : 'Name must be between 2 and 120 characters.'
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(createForm.email.trim())) {
      return lang === 'ar' ? 'صيغة البريد الإلكتروني غير صحيحة.' : 'Invalid email address format.'
    }
    if (createForm.password.length < 8) {
      return lang === 'ar' ? 'كلمة المرور يجب أن تكون 8 أحرف على الأقل' : 'Password must be at least 8 characters'
    }
    if (createForm.password.length > 72) {
      return lang === 'ar' ? 'كلمة المرور يجب ألا تزيد عن 72 حرفاً' : 'Password must be at most 72 characters'
    }
    if (createForm.password !== createForm.confirmPassword) {
      return lang === 'ar' ? 'كلمتا المرور غير متطابقتين' : 'Passwords do not match'
    }
    const studentPhone = validatePhone(createForm.phone)
    const guardianPhone = validatePhone(createForm.parentPhone)
    if (!studentPhone.isValid || !guardianPhone.isValid) {
      return lang === 'ar' ? 'تحقق من صيغة رقم الطالب وولي الأمر.' : 'Check the student and guardian phone numbers.'
    }
    if (createForm.groupId && !createGroupOptions.some((g) => String(g.id) === String(createForm.groupId))) {
      return lang === 'ar' ? 'المجموعة المختارة غير صالحة لهذا الصف.' : 'The selected group is not valid for this grade.'
    }
    return ''
  }

  const handleCreateStudent = async (e) => {
    e?.preventDefault?.()
    setCreateError('')
    const problem = validateCreateForm()
    if (problem) {
      setCreateError(problem)
      return
    }
    setCreating(true)
    try {
      const created = await adminCreateStudent({
        fullName: createForm.fullName.trim().replace(/\s+/g, ' '),
        email: createForm.email.trim().toLowerCase(),
        password: createForm.password,
        phone: normalizePhone(validatePhone(createForm.phone).normalized),
        parentPhone: normalizePhone(validatePhone(createForm.parentPhone).normalized),
        yearId: createForm.yearId,
        groupId: createForm.groupId || null,
        governorate: createForm.governorate,
        isActive: createForm.isActive,
      })
      // The password is shown once, here, so the teacher can hand it over:
      // it is stored as a bcrypt hash and can never be read back.
      setCreatedStudent({
        ...created,
        email: createForm.email.trim().toLowerCase(),
        password: createForm.password,
      })
      setSuccessMsg(lang === 'ar' ? 'تم إنشاء حساب الطالب بنجاح' : 'Student account created successfully')
      setTimeout(() => setSuccessMsg(''), 4000)
      onRefresh?.()
      loadPage()
    } catch (err) {
      setCreateError(err.message)
    } finally {
      setCreating(false)
    }
  }

  const copyCredentials = async () => {
    if (!createdStudent) return
    const text = `${createdStudent.email}\n${createdStudent.password}`
    try {
      await navigator.clipboard.writeText(text)
      setSuccessMsg(lang === 'ar' ? 'تم نسخ بيانات الدخول' : 'Login details copied')
      setTimeout(() => setSuccessMsg(''), 3000)
    } catch (_) {
      /* clipboard blocked (insecure context) — the values stay on screen */
    }
  }

  // Edit Student
  const openEdit = (s) => {
    setEditing(s)
    setEditForm({
      fullName: s.full_name || '',
      email: s.email || '',
      phone: s.phone || '',
      parentPhone: s.parent_phone || '',
      yearId: s.year_id || '5',
      groupId: s.group_id || '',
      governorate: s.governorate || '',
      isActive: s.is_active !== false,
    })
  }

  const handleSaveEdit = async () => {
    if (!editing) return
    setSavingEdit(true)
    try {
      await adminUpdateStudent(editing.id, {
        fullName: editForm.fullName,
        email: editForm.email,
        phone: editForm.phone,
        parentPhone: editForm.parentPhone,
        yearId: editForm.yearId,
        groupId: editForm.groupId || null,
        governorate: editForm.governorate,
        isActive: editForm.isActive,
      })
      setSuccessMsg(lang === 'ar' ? 'تم حفظ التعديلات بنجاح' : 'Changes saved successfully')
      setTimeout(() => setSuccessMsg(''), 3000)
      setEditing(null)
      onRefresh?.()
      loadPage()
    } catch (err) {
      alert(err.message)
    } finally {
      setSavingEdit(false)
    }
  }

  // Password Reset
  const openPasswordReset = (s) => {
    setPasswordModal(s)
    setNewPassword('')
    setConfirmNewPassword('')
    setPasswordError('')
  }

  const handleSetPassword = async () => {
    if (!passwordModal) return
    setPasswordError('')
    if (newPassword.length < 8) {
      setPasswordError(lang === 'ar' ? 'كلمة المرور يجب أن تكون 8 أحرف على الأقل' : 'Password must be at least 8 characters')
      return
    }
    if (newPassword.length > 72) {
      setPasswordError(lang === 'ar' ? 'كلمة المرور يجب ألا تزيد عن 72 حرفاً' : 'Password must be at most 72 characters')
      return
    }
    if (newPassword !== confirmNewPassword) {
      setPasswordError(lang === 'ar' ? 'كلمتا المرور غير متطابقتين' : 'Passwords do not match')
      return
    }
    setChangingPassword(true)
    try {
      await adminSetStudentPassword(passwordModal.id, newPassword)
      setSuccessMsg(lang === 'ar' ? 'تم تغيير كلمة المرور بنجاح' : 'Password changed successfully')
      setTimeout(() => setSuccessMsg(''), 3000)
      setPasswordModal(null)
    } catch (err) {
      setPasswordError(err.message)
    } finally {
      setChangingPassword(false)
    }
  }

  // Bulk Selection
  const toggleSelect = (id) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectAllVisible = () => {
    const ids = displayedStudents.map((s) => s.id)
    setSelected(new Set(ids))
  }

  const clearSelection = () => setSelected(new Set())

  const handleBulkAction = async () => {
    const ids = Array.from(selected)
    if (!ids.length) return
    setBulkSaving(true)
    try {
      if (bulkAction === 'group') {
        const count = await bulkUpdateStudentGroup(ids, bulkGroupId || null)
        setSuccessMsg(lang === 'ar' ? `تم تحديث مجموعة ${count} طالب` : `Updated group for ${count} students`)
      } else if (bulkAction === 'activate') {
        const count = await bulkUpdateStudentStatus(ids, true)
        setSuccessMsg(lang === 'ar' ? `تم تفعيل ${count} طالب` : `Activated ${count} students`)
      } else if (bulkAction === 'suspend') {
        const count = await bulkUpdateStudentStatus(ids, false)
        setSuccessMsg(lang === 'ar' ? `تم إيقاف ${count} طالب` : `Suspended ${count} students`)
      }
      setTimeout(() => setSuccessMsg(''), 3000)
      setBulkAction(null)
      clearSelection()
      onRefresh?.()
      loadPage()
    } catch (err) {
      alert(err.message)
    } finally {
      setBulkSaving(false)
    }
  }

  // Attendance cancel from detail modal
  const handleCancelAttendance = async (studentId, sessionDate) => {
    if (!confirm(lang === 'ar' ? 'هل أنت متأكد من حذف سجل الحضور لهذا التاريخ؟' : 'Are you sure you want to delete this attendance record?')) return
    setCancellingAttendance(sessionDate)
    try {
      await cancelAttendance(studentId, sessionDate)
      setSuccessMsg(lang === 'ar' ? 'تم حذف سجل الحضور' : 'Attendance record deleted')
      setTimeout(() => setSuccessMsg(''), 3000)
      // Refresh detail data
      if (detail) {
        const att = await fetchAttendanceForStudent(studentId)
        setDetailData((prev) => prev ? { ...prev, attendance: att } : prev)
      }
    } catch (err) {
      alert(err.message)
    } finally {
      setCancellingAttendance(null)
    }
  }

  return (
    <div className="space-y-6 font-ibm">
      {successMsg && (
        <div className="p-3.5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-700 text-emerald-800 dark:text-emerald-300 text-xs font-bold text-center flex items-center justify-center gap-2">
          <Check className="w-4 h-4 text-emerald-500" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Main Student Card & Filters */}
      <div className="bg-white dark:bg-zinc-900 rounded-3xl p-6 border border-slate-200 dark:border-zinc-800 shadow-sm space-y-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-yellow-500" />
            <h3 className="font-bold text-lg">
              <span>{t('adminStudents')} ({totalStudents})</span>
            </h3>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={openCreate}
              className="px-4 py-2 rounded-xl bg-yellow-400 hover:bg-yellow-300 text-black text-xs font-extrabold flex items-center gap-1.5 shadow shadow-yellow-400/20 transition"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>{lang === 'ar' ? 'إضافة طالب' : 'Add Student'}</span>
            </button>
            <button
              onClick={() => setShowManageGroups(true)}
              className="px-4 py-2 rounded-xl bg-purple-50 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-800 text-purple-700 dark:text-purple-300 text-xs font-bold flex items-center gap-1.5 hover:bg-purple-100 transition"
            >
              <Tag className="w-3.5 h-3.5" />
              <span>{t('manageGroups')} ({groups.length})</span>
            </button>
          </div>
        </div>

        {/* Filter Controls */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {/* Search */}
          <div className="lg:col-span-2">
            <label className="block text-xs font-bold text-slate-500 mb-1">{lang === 'ar' ? 'البحث' : 'Search'}</label>
            <div className="relative w-full">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={lang === 'ar' ? 'ابحث بالاسم أو البريد أو الهاتف...' : 'Search name, email or phone...'}
                className="w-full px-4 py-2.5 ltr:pl-10 rtl:pr-10 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-black text-xs"
              />
              <Search className="w-4 h-4 absolute top-3 ltr:left-3.5 rtl:right-3.5 text-slate-400" />
            </div>
          </div>

          {/* Grade Filter */}
          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1">{t('gradeLabel')}</label>
            <select
              value={yearFilter}
              onChange={(e) => setYearFilter(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-black text-xs font-bold"
            >
              <option value="all">{t('allGrades')}</option>
              {YEARS.map((y) => (
                <option key={y.id} value={y.id}>
                  {lang === 'ar' ? y.titleAr : y.title}
                </option>
              ))}
            </select>
          </div>

          {/* Group Filter */}
          <div>
            <GroupFilterSelect value={groupId} onChange={setGroupId} groups={groups} includeNone />
          </div>

          {/* Status Filter */}
          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1">{lang === 'ar' ? 'الحالة' : 'Status'}</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-black text-xs font-bold"
            >
              <option value="all">{lang === 'ar' ? 'الكل' : 'All'}</option>
              <option value="active">{lang === 'ar' ? 'مفعّل' : 'Active'}</option>
              <option value="suspended">{lang === 'ar' ? 'موقوف' : 'Suspended'}</option>
            </select>
          </div>
        </div>

        {/* Bulk Actions Bar */}
        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 p-3 rounded-2xl bg-yellow-400/10 border border-yellow-400/30">
            <span className="text-xs font-bold text-yellow-700 dark:text-yellow-300">
              {selected.size} {lang === 'ar' ? 'محدد' : 'selected'}
            </span>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => setBulkAction('group')}
                className="px-3 py-1.5 rounded-lg bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 text-xs font-bold"
              >
                {lang === 'ar' ? 'تعيين مجموعة' : 'Assign Group'}
              </button>
              <button
                onClick={() => setBulkAction('activate')}
                className="px-3 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 text-xs font-bold"
              >
                {lang === 'ar' ? 'تفعيل' : 'Activate'}
              </button>
              <button
                onClick={() => setBulkAction('suspend')}
                className="px-3 py-1.5 rounded-lg bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 text-xs font-bold"
              >
                {lang === 'ar' ? 'إيقاف' : 'Suspend'}
              </button>
              <button onClick={clearSelection} className="px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 text-xs font-bold">
                {lang === 'ar' ? 'إلغاء التحديد' : 'Clear'}
              </button>
            </div>
          </div>
        )}

        {/* Select All / Pagination Controls */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <button
              onClick={selectAllVisible}
              className="px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 text-xs font-bold flex items-center gap-1.5"
            >
              <CheckSquare className="w-3.5 h-3.5" />
              {lang === 'ar' ? 'تحديد الكل' : 'Select All'}
            </button>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="p-2 rounded-lg bg-slate-100 dark:bg-zinc-800 disabled:opacity-30 text-slate-600 dark:text-zinc-300"
              >
                {lang === 'ar' ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
              </button>
              <span className="text-xs font-bold text-slate-500">
                {page} / {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="p-2 rounded-lg bg-slate-100 dark:bg-zinc-800 disabled:opacity-30 text-slate-600 dark:text-zinc-300"
              >
                {lang === 'ar' ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              </button>
            </div>
          )}
        </div>

        {/* Student Cards List */}
        {loadingPage ? (
          <div className="py-12 flex justify-center"><Loader2 className="w-7 h-7 animate-spin text-yellow-500" /></div>
        ) : displayedStudents.length === 0 ? (
          <p className="text-center text-sm text-slate-500 py-10">— {t('noStudentsFound')} —</p>
        ) : (
          <div className="space-y-3">
            {displayedStudents.map((s) => {
              const a = analyticsFor(s.id)
              const studentGroupId = s.group_id || groups.find(
                (group) => group.name === (s.group_name || s.groupName) && String(group.year_id) === String(s.year_id)
              )?.id || ''
              const isSelected = selected.has(s.id)

              return (
                <div
                  key={s.id}
                  className={`p-4 rounded-2xl border space-y-3 transition ${
                    isSelected
                      ? 'bg-yellow-400/5 border-yellow-400/50 dark:bg-yellow-400/5'
                      : 'bg-slate-50 dark:bg-black/50 border-slate-100 dark:border-zinc-800 hover:border-yellow-400/40'
                  }`}
                >
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    {/* Checkbox + Student Basic Info */}
                    <div className="flex items-start gap-3 min-w-0">
                      <button
                        onClick={() => toggleSelect(s.id)}
                        className="mt-1 shrink-0 text-yellow-500 hover:text-yellow-600"
                        aria-label={isSelected ? 'Deselect' : 'Select'}
                      >
                        {isSelected ? <CheckSquare className="w-5 h-5" /> : <Square className="w-5 h-5 text-slate-300 dark:text-zinc-600" />}
                      </button>
                      <div className="min-w-0 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <button
                            onClick={() => openDetail(s)}
                            className="font-bold text-sm hover:text-yellow-500 transition text-start"
                          >
                            {s.full_name}
                          </button>
                          <span className="text-[11px] px-2.5 py-0.5 rounded-full bg-slate-200 dark:bg-zinc-800 text-slate-700 dark:text-zinc-300 font-bold">
                            {lang === 'ar'
                              ? YEARS.find((y) => y.id === s.year_id)?.shortTitleAr
                              : YEARS.find((y) => y.id === s.year_id)?.shortTitle}
                          </span>
                          {s.email && (
                            <span className="text-[11px] text-slate-400 font-mono truncate max-w-[200px]" dir="ltr">
                              {s.email}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-500 font-mono" dir="ltr">
                          {s.phone} {s.parent_phone ? `· ${lang === 'ar' ? 'ولي الأمر' : 'Guardian'}: ${s.parent_phone}` : ''}
                        </p>
                      </div>
                    </div>

                    {/* Group Selector & Student Status Actions */}
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <div className="flex items-center gap-1.5 bg-white dark:bg-zinc-900 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-zinc-700">
                        <Layers className="w-3.5 h-3.5 text-yellow-500 shrink-0" />
                        <select
                          value={studentGroupId}
                          onChange={(e) => handleGroupChange(s.id, e.target.value)}
                          className="bg-transparent text-xs font-bold text-slate-800 dark:text-zinc-200 focus:outline-none cursor-pointer max-w-[140px]"
                        >
                          <option value="">{t('noGroupAssigned')}</option>
                          {groups
                            .filter((group) => !group.year_id || String(group.year_id) === String(s.year_id))
                            .map((group) => (
                              <option key={group.id} value={group.id}>
                                {group.name}
                              </option>
                            ))}
                        </select>
                      </div>

                      <span
                        className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${
                          s.is_active
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                            : 'bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300'
                        }`}
                      >
                        {s.is_active ? '🟢' : '🔴'}
                      </span>

                      <button
                        onClick={() => openEdit(s)}
                        className="p-2 rounded-lg bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 hover:text-yellow-500 transition"
                        title={t('edit')}
                      >
                        <Edit3 className="w-4 h-4" />
                      </button>

                      <button
                        onClick={() => toggleActive(s)}
                        className="px-3 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 text-xs font-bold"
                      >
                        {s.is_active ? (lang === 'ar' ? 'إيقاف' : 'Suspend') : (lang === 'ar' ? 'تفعيل' : 'Activate')}
                      </button>

                      <WhatsAppReportButton student={s} compact />
                    </div>
                  </div>

                  {/* Mini Analytics Bars */}
                  <div className="grid grid-cols-3 gap-3 text-[11px] pt-1">
                    <div className="space-y-1">
                      <div className="flex justify-between font-bold">
                        <span className="text-slate-500">{t('attendanceRate')}</span>
                        <span>{a.attendance_percent ?? 0}%</span>
                      </div>
                      <Bar value={a.attendance_percent} color="bg-emerald-500" />
                    </div>
                    <div className="space-y-1">
                      <div className="flex justify-between font-bold">
                        <span className="text-slate-500">{t('quizAverage')}</span>
                        <span>{a.avg_quiz_percent ?? 0}%</span>
                      </div>
                      <Bar value={a.avg_quiz_percent} color="bg-yellow-400" />
                    </div>
                    <div className="space-y-1">
                      <div className="flex justify-between font-bold">
                        <span className="text-slate-500">{t('assignmentAverage')}</span>
                        <span>{a.avg_assignment_percent ?? 0}%</span>
                      </div>
                      <Bar value={a.avg_assignment_percent} color="bg-purple-500" />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Group Management Modal */}
      {showManageGroups && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white dark:bg-zinc-900 rounded-t-3xl sm:rounded-3xl w-full sm:max-w-lg max-h-[90vh] sm:max-h-[85vh] overflow-y-auto shadow-2xl border border-slate-200 dark:border-zinc-800">
            <div className="sticky top-0 z-10 bg-white/90 dark:bg-zinc-900/90 backdrop-blur-md flex items-center justify-between border-b border-slate-200 dark:border-zinc-800 px-6 py-4">
              <h3 className="font-bold text-lg flex items-center gap-2">
                <Tag className="w-5 h-5 text-yellow-500" />
                <span>{t('manageGroups')}</span>
              </h3>
              <button onClick={() => setShowManageGroups(false)} className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:text-white dark:hover:bg-zinc-800 transition">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-5">
              <form onSubmit={handleAddGroup} className="space-y-3 bg-gradient-to-br from-yellow-50 to-amber-50 dark:from-yellow-400/10 dark:to-amber-400/5 p-5 rounded-2xl border border-yellow-200 dark:border-yellow-400/20">
                <div className="flex items-center gap-2">
                  <span className="w-8 h-8 rounded-lg bg-yellow-400 text-black flex items-center justify-center shrink-0">
                    <Plus className="w-4 h-4" />
                  </span>
                  <label className="block text-sm font-extrabold">{t('addGroup')}</label>
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text" required value={newGroupName}
                    onChange={(e) => setNewGroupName(e.target.value)}
                    placeholder={t('groupNamePlaceholder')}
                    className="flex-1 min-w-0 px-4 py-3 rounded-xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-yellow-400"
                  />
                  <select value={newGroupYear} onChange={(e) => setNewGroupYear(e.target.value)} className="sm:w-40 px-4 py-3 rounded-xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm font-bold cursor-pointer">
                    {YEARS.map((y) => (
                      <option key={y.id} value={y.id}>{lang === 'ar' ? y.shortTitleAr : y.shortTitle}</option>
                    ))}
                  </select>
                </div>
                <button type="submit" disabled={addingGroup} className="w-full py-3 rounded-xl bg-yellow-400 hover:bg-yellow-300 disabled:opacity-60 text-black font-extrabold text-sm flex items-center justify-center gap-2 shadow-md transition">
                  {addingGroup ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  <span>{t('saveGroup')}</span>
                </button>
              </form>

              <div className="space-y-2">
                <div className="flex items-center justify-between px-1">
                  <label className="block text-xs font-bold text-slate-500">{lang === 'ar' ? 'المجموعات الحالية' : 'Current groups'}</label>
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-zinc-800 text-slate-500">{groups.length}</span>
                </div>
                {groupsError ? (
                  <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-xs font-bold flex items-center justify-between gap-3">
                    <span>{lang === 'ar' ? 'تعذر تحميل المجموعات.' : 'Unable to load groups.'}</span>
                    <button onClick={loadGroups} className="shrink-0 underline underline-offset-2">
                      {lang === 'ar' ? 'إعادة المحاولة' : 'Retry'}
                    </button>
                  </div>
                ) : groups.length === 0 ? (
                  <div className="text-center py-8 rounded-2xl border border-dashed border-slate-200 dark:border-zinc-800">
                    <Tag className="w-8 h-8 text-slate-300 dark:text-zinc-600 mx-auto mb-2" />
                    <p className="text-xs text-slate-400 font-bold">{lang === 'ar' ? 'لا توجد مجموعات' : 'No groups yet'}</p>
                  </div>
                ) : (
                  <ul className="space-y-2">
                    {groups.map((g) => (
                      <li key={g.id} className="flex items-center justify-between gap-3 p-3 rounded-xl bg-slate-50 dark:bg-zinc-800/60 border border-slate-100 dark:border-zinc-700/50">
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="w-9 h-9 rounded-lg bg-purple-100 dark:bg-purple-500/15 text-purple-600 dark:text-purple-300 flex items-center justify-center shrink-0">
                            <Tag className="w-4 h-4" />
                          </span>
                          <div className="min-w-0">
                            <span className="font-bold text-sm block truncate">{g.name}</span>
                            <span className="text-[11px] text-slate-400 font-bold">
                              {lang === 'ar' ? YEARS.find((y) => y.id === g.year_id)?.shortTitleAr : YEARS.find((y) => y.id === g.year_id)?.shortTitle || 'General'}
                            </span>
                          </div>
                        </div>
                        <button onClick={() => handleDeleteGroup(g.id)} className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 shrink-0">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Student Detail Modal */}
      {detail && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-zinc-900 rounded-3xl p-6 sm:p-8 max-w-2xl w-full space-y-5 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-lg flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-yellow-500" />
                <span>{detail.full_name}</span>
              </h3>
              <button onClick={() => { setDetail(null); setDetailData(null) }} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            {loadingDetail || !detailData ? (
              <div className="py-12 flex justify-center"><Loader2 className="w-7 h-7 animate-spin text-yellow-500" /></div>
            ) : (
              <>
                {/* Identity — name, status, grade, group, registration date */}
                <div className="flex items-start justify-between gap-3 flex-wrap p-3.5 rounded-2xl bg-yellow-400/10 border border-yellow-400/30">
                  <div className="min-w-0 space-y-1">
                    <p className="font-extrabold text-sm truncate">{detail.full_name}</p>
                    <p className="text-[11px] text-slate-500 font-bold">
                      {lang === 'ar'
                        ? YEARS.find((y) => y.id === detail.year_id)?.shortTitleAr
                        : YEARS.find((y) => y.id === detail.year_id)?.shortTitle}
                      {detail.group_name ? ` · ${detail.group_name}` : ` · ${t('noGroupAssigned')}`}
                    </p>
                    <p className="text-[10px] text-slate-400 font-bold flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {lang === 'ar' ? 'تاريخ التسجيل' : 'Registered'}:{' '}
                      <span className="font-mono">
                        {detail.created_at
                          ? new Date(detail.created_at).toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-GB')
                          : '—'}
                      </span>
                    </p>
                  </div>
                  <span
                    className={`shrink-0 px-2.5 py-1 rounded-full text-[11px] font-bold ${
                      detail.is_active
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                        : 'bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300'
                    }`}
                  >
                    {detail.is_active
                      ? (lang === 'ar' ? 'حساب مفعّل' : 'Active account')
                      : (lang === 'ar' ? 'حساب موقوف' : 'Suspended account')}
                  </span>
                </div>

                {/* Contact Info */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div className="flex items-center gap-2 p-3 rounded-xl bg-slate-50 dark:bg-black/50">
                    <Mail className="w-4 h-4 text-yellow-500 shrink-0" />
                    <span className="font-mono truncate" dir="ltr">{detail.email || '—'}</span>
                  </div>
                  <div className="flex items-center gap-2 p-3 rounded-xl bg-slate-50 dark:bg-black/50">
                    <Phone className="w-4 h-4 text-yellow-500 shrink-0" />
                    <span className="font-mono" dir="ltr">{detail.phone || '—'}</span>
                  </div>
                  <div className="flex items-center gap-2 p-3 rounded-xl bg-slate-50 dark:bg-black/50">
                    <Phone className="w-4 h-4 text-green-500 shrink-0" />
                    <span className="text-slate-500">{lang === 'ar' ? 'ولي الأمر' : 'Guardian'}:</span>
                    <span className="font-mono truncate" dir="ltr">{detail.parent_phone || '—'}</span>
                  </div>
                  <div className="flex items-center gap-2 p-3 rounded-xl bg-slate-50 dark:bg-black/50">
                    <MapPin className="w-4 h-4 text-purple-500 shrink-0" />
                    <span className="truncate">{detail.governorate || '—'}</span>
                  </div>
                </div>

                {/* Analytics */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { label: t('attendanceRate'), value: `${detailData.analytics.attendance_percent ?? 0}%` },
                    { label: t('quizAverage'), value: `${detailData.analytics.avg_quiz_percent ?? 0}%` },
                    { label: t('assignmentAverage'), value: `${detailData.analytics.avg_assignment_percent ?? 0}%` },
                    { label: t('absent'), value: detailData.analytics.absent_count ?? 0 },
                  ].map((c) => (
                    <div key={c.label} className="p-3 rounded-2xl bg-slate-50 dark:bg-black/50 border border-slate-100 dark:border-zinc-800 text-center">
                      <p className="text-[10px] text-slate-500 font-bold">{c.label}</p>
                      <p className="text-xl font-extrabold text-yellow-500">{c.value}</p>
                    </div>
                  ))}
                </div>

                {/* Grades */}
                <div>
                  <h4 className="font-bold text-sm mb-2">{t('gradesTab')}</h4>
                  {detailData.grades.length === 0 ? (
                    <p className="text-xs text-slate-500">{t('noGradesYet')}</p>
                  ) : (
                    <div className="space-y-1.5">
                      {detailData.grades.map((g) => (
                        <div key={g.id} className="flex justify-between text-xs p-2.5 rounded-lg bg-slate-50 dark:bg-black/50">
                          <span className="font-bold truncate">{g.quizzes?.title}</span>
                          <span className="font-mono shrink-0">{g.score} / {g.quizzes?.max_score}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Attendance with Cancel */}
                <div>
                  <h4 className="font-bold text-sm mb-2">{t('attendanceTab')}</h4>
                  {detailData.attendance.length === 0 ? (
                    <p className="text-xs text-slate-500">{t('noAttendanceYet')}</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {detailData.attendance.slice(0, 30).map((a) => (
                        <span
                          key={a.id}
                          title={a.session_date}
                          className={`px-2 py-1 rounded-md text-[10px] font-bold cursor-pointer ${
                            a.status === 'present'
                              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                              : a.status === 'absent'
                              ? 'bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300'
                              : a.status === 'late'
                              ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300'
                              : 'bg-slate-100 text-slate-600 dark:bg-zinc-800 dark:text-zinc-400'
                          }`}
                          onClick={() => handleCancelAttendance(detail.id, a.session_date)}
                        >
                          {a.session_date?.slice(5)} {cancellingAttendance === a.session_date ? '...' : ''}
                        </span>
                      ))}
                    </div>
                  )}
                  <p className="text-[10px] text-slate-400 mt-1">{lang === 'ar' ? 'اضغط على تاريخ لحذف السجل' : 'Click a date to delete record'}</p>
                </div>

                {/* Homework History */}
                <div>
                  <h4 className="font-bold text-sm mb-2 flex items-center gap-1.5">
                    <ClipboardList className="w-4 h-4 text-yellow-500" />
                    <span>{t('homeworkHistorySection')}</span>
                  </h4>
                  {detailData.homeworkEntries.length === 0 ? (
                    <p className="text-xs text-slate-500">{t('noHomeworkYet')}</p>
                  ) : (
                    <div className="space-y-1.5">
                      {detailData.homeworkEntries.map((hw) => {
                        const sub = detailData.homeworkSubmissions.find((x) => x.assignment_id === hw.id)
                        const total = hw.totalPoints || hw.maxScore || 0
                        const graded = sub?.status === 'graded' && sub?.score != null
                        return (
                          <div key={hw.id} className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-slate-50 dark:bg-black/50 text-xs">
                            <div className="min-w-0">
                              <span className="font-bold truncate block">{hw.title}</span>
                              <span className="text-[10px] text-slate-400">
                                {sub ? new Date(sub.submitted_at || sub.graded_at || Date.now()).toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-GB') : t('notSubmittedShort')}
                              </span>
                            </div>
                            {graded ? (
                              <span className="px-2.5 py-1 rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 font-extrabold font-mono shrink-0">
                                {sub.score} / {total}
                              </span>
                            ) : sub ? (
                              <span className="px-2.5 py-1 rounded-lg bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300 font-bold shrink-0">{t('submitted')}</span>
                            ) : (
                              <span className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-500 dark:bg-zinc-800 dark:text-zinc-400 font-bold shrink-0">{t('notSubmitted')}</span>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <button onClick={() => { openEdit(detail); setDetail(null) }} className="px-4 py-2 rounded-xl bg-yellow-400 hover:bg-yellow-300 text-black text-xs font-bold flex items-center gap-1.5">
                    <Edit3 className="w-3.5 h-3.5" /> {t('edit')}
                  </button>
                  <button onClick={() => { openPasswordReset(detail); setDetail(null) }} className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 text-xs font-bold flex items-center gap-1.5">
                    <Lock className="w-3.5 h-3.5" /> {lang === 'ar' ? 'تغيير كلمة المرور' : 'Change Password'}
                  </button>
                  <WhatsAppReportButton student={detail} />
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Create Student Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-zinc-900 rounded-3xl p-6 sm:p-8 max-w-lg w-full space-y-5 max-h-[88vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-zinc-800 pb-3">
              <h3 className="font-bold text-lg flex items-center gap-2">
                <UserPlus className="w-5 h-5 text-yellow-500" />
                <span>{lang === 'ar' ? 'إضافة طالب جديد' : 'Add New Student'}</span>
              </h3>
              <button onClick={() => setShowCreate(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            {createdStudent ? (
              /* The account exists — show the credentials ONCE. */
              <div className="space-y-5">
                <div className="p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-700 text-emerald-800 dark:text-emerald-300 text-xs font-bold flex items-start gap-2">
                  <Check className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>
                    {lang === 'ar'
                      ? 'تم إنشاء الحساب ويمكن للطالب تسجيل الدخول فوراً. احفظ بيانات الدخول الآن — لن تظهر كلمة المرور مرة أخرى.'
                      : 'The account is created and the student can sign in right away. Save these details now — the password is never shown again.'}
                  </span>
                </div>

                <div className="space-y-2 p-4 rounded-2xl bg-slate-50 dark:bg-black/50 border border-slate-200 dark:border-zinc-800">
                  <p className="text-sm font-bold truncate">{createdStudent.full_name}</p>
                  <div className="flex items-center gap-2 text-xs">
                    <Mail className="w-3.5 h-3.5 text-yellow-500 shrink-0" />
                    <span className="font-mono truncate" dir="ltr">{createdStudent.email}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <Lock className="w-3.5 h-3.5 text-yellow-500 shrink-0" />
                    <span className="font-mono truncate" dir="ltr">{createdStudent.password}</span>
                  </div>
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={copyCredentials}
                    className="flex-1 py-3 rounded-xl bg-slate-100 dark:bg-zinc-800 font-bold text-sm flex items-center justify-center gap-2"
                  >
                    <Copy className="w-4 h-4" />
                    <span>{lang === 'ar' ? 'نسخ بيانات الدخول' : 'Copy Login Details'}</span>
                  </button>
                  <button
                    onClick={() => { setCreatedStudent(null); setCreateForm({ ...EMPTY_NEW_STUDENT, yearId: createForm.yearId }) }}
                    className="px-5 py-3 rounded-xl bg-yellow-400 hover:bg-yellow-300 text-black font-extrabold text-sm"
                  >
                    {lang === 'ar' ? 'إضافة آخر' : 'Add Another'}
                  </button>
                </div>
                <button
                  onClick={() => setShowCreate(false)}
                  className="w-full py-2.5 rounded-xl border border-slate-200 dark:border-zinc-800 font-bold text-xs"
                >
                  {lang === 'ar' ? 'إغلاق' : 'Close'}
                </button>
              </div>
            ) : (
              <form onSubmit={handleCreateStudent} className="space-y-4">
                {createError && (
                  <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-xs font-bold text-center">
                    {createError}
                  </div>
                )}

                <div>
                  <label className="block text-xs font-bold mb-1">{t('fullNameLabel')}</label>
                  <input
                    type="text" required value={createForm.fullName}
                    onChange={(e) => setCreateField({ fullName: e.target.value })}
                    placeholder={lang === 'ar' ? 'الاسم الكامل للطالب' : "Student's full name"}
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-black text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold mb-1">{t('emailLabel')}</label>
                  <input
                    type="email" required dir="ltr" value={createForm.email}
                    autoComplete="off"
                    onChange={(e) => setCreateField({ email: e.target.value })}
                    placeholder="student@example.com"
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-black text-sm"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold mb-1">{lang === 'ar' ? 'كلمة المرور' : 'Password'}</label>
                    <div className="relative">
                      <input
                        type={showCreatePassword ? 'text' : 'password'} required minLength={8}
                        value={createForm.password} autoComplete="new-password" dir="ltr"
                        onChange={(e) => setCreateField({ password: e.target.value })}
                        className="w-full px-4 py-2.5 ltr:pr-10 rtl:pl-10 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-black text-sm"
                      />
                      <button
                        type="button" onClick={() => setShowCreatePassword((v) => !v)}
                        className="absolute top-2.5 ltr:right-3 rtl:left-3 text-slate-400 hover:text-slate-600"
                        aria-label={showCreatePassword ? 'Hide password' : 'Show password'}
                      >
                        {showCreatePassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    <p className="text-[10px] text-slate-400 font-bold mt-1">
                      {lang === 'ar' ? '8 أحرف على الأقل' : 'At least 8 characters'}
                    </p>
                  </div>
                  <div>
                    <label className="block text-xs font-bold mb-1">{lang === 'ar' ? 'تأكيد كلمة المرور' : 'Confirm Password'}</label>
                    <input
                      type={showCreatePassword ? 'text' : 'password'} required minLength={8} dir="ltr"
                      value={createForm.confirmPassword} autoComplete="new-password"
                      onChange={(e) => setCreateField({ confirmPassword: e.target.value })}
                      className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-black text-sm"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold mb-1">{t('studentPhoneLabel')}</label>
                    <input
                      type="tel" required dir="ltr" value={createForm.phone}
                      onChange={(e) => setCreateField({ phone: e.target.value })}
                      placeholder="01xxxxxxxxx"
                      className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-black text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold mb-1">{t('parentPhoneLabel')}</label>
                    <input
                      type="tel" required dir="ltr" value={createForm.parentPhone}
                      onChange={(e) => setCreateField({ parentPhone: e.target.value })}
                      placeholder="01xxxxxxxxx"
                      className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-black text-sm"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold mb-1">{t('gradeLabel')}</label>
                    <select
                      value={createForm.yearId}
                      onChange={(e) => setCreateField({ yearId: e.target.value })}
                      className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-black text-sm"
                    >
                      {YEARS.map((y) => <option key={y.id} value={y.id}>{lang === 'ar' ? y.titleAr : y.title}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold mb-1">{t('studentGroup')}</label>
                    <select
                      value={createForm.groupId}
                      onChange={(e) => setCreateField({ groupId: e.target.value })}
                      className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-black text-sm"
                    >
                      <option value="">{t('noGroupAssigned')}</option>
                      {createGroupOptions.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold mb-1">{t('governorateLabel')}</label>
                  <select
                    value={createForm.governorate}
                    onChange={(e) => setCreateField({ governorate: e.target.value })}
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-black text-sm"
                  >
                    {GOVERNORATES.map((g) => <option key={g} value={g}>{g}</option>)}
                  </select>
                </div>

                <label className="flex items-center gap-2.5 text-sm font-bold">
                  <input
                    type="checkbox" checked={createForm.isActive}
                    onChange={(e) => setCreateField({ isActive: e.target.checked })}
                    className="w-4 h-4 accent-yellow-400"
                  />
                  <span>{lang === 'ar' ? 'حساب مفعّل' : 'Active Account'}</span>
                </label>

                <div className="flex gap-3 pt-2">
                  <button
                    type="submit" disabled={creating}
                    className="flex-1 py-3 rounded-xl bg-yellow-400 hover:bg-yellow-300 disabled:opacity-60 text-black font-extrabold text-sm flex items-center justify-center gap-2 shadow"
                  >
                    {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                    <span>{lang === 'ar' ? 'إنشاء الحساب' : 'Create Account'}</span>
                  </button>
                  <button
                    type="button" onClick={() => setShowCreate(false)}
                    className="px-6 py-3 rounded-xl bg-slate-100 dark:bg-zinc-800 font-bold text-sm"
                  >
                    {t('cancel')}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Edit Student Modal */}
      {editing && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-zinc-900 rounded-3xl p-6 sm:p-8 max-w-lg w-full space-y-5 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-zinc-800 pb-3">
              <h3 className="font-bold text-lg flex items-center gap-2">
                <Edit3 className="w-5 h-5 text-yellow-500" />
                <span>{lang === 'ar' ? 'تعديل بيانات الطالب' : 'Edit Student'}</span>
              </h3>
              <button onClick={() => setEditing(null)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold mb-1">{t('fullNameLabel')}</label>
                <input type="text" value={editForm.fullName} onChange={(e) => setEditForm({ ...editForm, fullName: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-black text-sm" />
              </div>
              <div>
                <label className="block text-xs font-bold mb-1">{t('emailLabel')}</label>
                <input type="email" value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} dir="ltr"
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-black text-sm" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold mb-1">{t('studentPhoneLabel')}</label>
                  <input type="tel" value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-black text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-bold mb-1">{t('parentPhoneLabel')}</label>
                  <input type="tel" value={editForm.parentPhone} onChange={(e) => setEditForm({ ...editForm, parentPhone: e.target.value })}
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-black text-sm" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold mb-1">{t('gradeLabel')}</label>
                  <select value={editForm.yearId} onChange={(e) => setEditForm({ ...editForm, yearId: e.target.value })}
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-black text-sm">
                    {YEARS.map((y) => <option key={y.id} value={y.id}>{lang === 'ar' ? y.titleAr : y.title}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold mb-1">{t('studentGroup')}</label>
                  <select value={editForm.groupId} onChange={(e) => setEditForm({ ...editForm, groupId: e.target.value })}
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-black text-sm">
                    <option value="">{t('noGroupAssigned')}</option>
                    {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold mb-1">{t('governorateLabel')}</label>
                <select value={editForm.governorate} onChange={(e) => setEditForm({ ...editForm, governorate: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-black text-sm">
                  {GOVERNORATES.map((g) => <option key={g} value={g}>{g}</option>)}
                </select>
              </div>
              <label className="flex items-center gap-2.5 text-sm font-bold">
                <input type="checkbox" checked={editForm.isActive} onChange={(e) => setEditForm({ ...editForm, isActive: e.target.checked })}
                  className="w-4 h-4 accent-yellow-400" />
                <span>{lang === 'ar' ? 'حساب مفعّل' : 'Active Account'}</span>
              </label>
            </div>

            <div className="flex gap-3 pt-2">
              <button onClick={handleSaveEdit} disabled={savingEdit}
                className="flex-1 py-3 rounded-xl bg-yellow-400 hover:bg-yellow-300 disabled:opacity-60 text-black font-extrabold text-sm flex items-center justify-center gap-2 shadow">
                {savingEdit ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                <span>{t('save')}</span>
              </button>
              <button onClick={() => setEditing(null)} className="px-6 py-3 rounded-xl bg-slate-100 dark:bg-zinc-800 font-bold text-sm">{t('cancel')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Password Reset Modal */}
      {passwordModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-zinc-900 rounded-3xl p-6 sm:p-8 max-w-md w-full space-y-5">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-zinc-800 pb-3">
              <h3 className="font-bold text-lg flex items-center gap-2">
                <Lock className="w-5 h-5 text-yellow-500" />
                <span>{lang === 'ar' ? 'تغيير كلمة المرور' : 'Change Password'}</span>
              </h3>
              <button onClick={() => setPasswordModal(null)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>

            <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-xs font-bold text-amber-700 dark:text-amber-300 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{lang === 'ar' ? 'سيتم تعيين كلمة مرور جديدة للطالب. لا يمكن استرجاع كلمة المرور القديمة.' : 'A new password will be set for this student. The old password cannot be recovered.'}</span>
            </div>

            {/* Who the change applies to — the CURRENT password is never
                requested, read or shown: Supabase only stores a bcrypt
                hash in auth.users and nothing can reverse it. */}
            <div className="space-y-1.5 p-3.5 rounded-xl bg-slate-50 dark:bg-black/50 border border-slate-200 dark:border-zinc-800">
              <p className="text-sm font-bold truncate">{passwordModal.full_name}</p>
              <p className="text-[11px] font-mono text-slate-500 truncate" dir="ltr">{passwordModal.email || '—'}</p>
            </div>

            {passwordError && (
              <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-xs font-bold text-center">
                {passwordError}
              </div>
            )}

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold mb-1">{lang === 'ar' ? 'كلمة المرور الجديدة' : 'New Password'}</label>
                <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} minLength={8}
                  autoComplete="new-password"
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-black text-sm" />
                <p className="text-[10px] text-slate-400 font-bold mt-1">
                  {lang === 'ar' ? '8 أحرف على الأقل' : 'At least 8 characters'}
                </p>
              </div>
              <div>
                <label className="block text-xs font-bold mb-1">{lang === 'ar' ? 'تأكيد كلمة المرور' : 'Confirm New Password'}</label>
                <input type="password" value={confirmNewPassword} onChange={(e) => setConfirmNewPassword(e.target.value)} minLength={8}
                  autoComplete="new-password"
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-black text-sm" />
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button onClick={handleSetPassword} disabled={changingPassword}
                className="flex-1 py-3 rounded-xl bg-yellow-400 hover:bg-yellow-300 disabled:opacity-60 text-black font-extrabold text-sm flex items-center justify-center gap-2 shadow">
                {changingPassword ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
                <span>{lang === 'ar' ? 'تغيير كلمة المرور' : 'Change Password'}</span>
              </button>
              <button onClick={() => setPasswordModal(null)} className="px-6 py-3 rounded-xl bg-slate-100 dark:bg-zinc-800 font-bold text-sm">{t('cancel')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Action Modal */}
      {bulkAction && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-zinc-900 rounded-3xl p-6 max-w-sm w-full space-y-5">
            <h3 className="font-bold text-lg flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-yellow-500" />
              <span>{
                bulkAction === 'group' ? (lang === 'ar' ? 'تعيين مجموعة' : 'Assign Group') :
                bulkAction === 'activate' ? (lang === 'ar' ? 'تفعيل الطلاب' : 'Activate Students') :
                (lang === 'ar' ? 'إيقاف الطلاب' : 'Suspend Students')
              }</span>
            </h3>
            <p className="text-sm text-slate-500">
              {selected.size} {lang === 'ar' ? 'طالب محدد' : 'students selected'}
            </p>

            {bulkAction === 'group' && (
              <select value={bulkGroupId} onChange={(e) => setBulkGroupId(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-black text-sm font-bold">
                <option value="">{t('noGroupAssigned')}</option>
                {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            )}

            <div className="flex gap-3">
              <button onClick={handleBulkAction} disabled={bulkSaving}
                className="flex-1 py-3 rounded-xl bg-yellow-400 hover:bg-yellow-300 disabled:opacity-60 text-black font-extrabold text-sm flex items-center justify-center gap-2">
                {bulkSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                <span>{lang === 'ar' ? 'تأكيد' : 'Confirm'}</span>
              </button>
              <button onClick={() => setBulkAction(null)} className="px-6 py-3 rounded-xl bg-slate-100 dark:bg-zinc-800 font-bold text-sm">{t('cancel')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

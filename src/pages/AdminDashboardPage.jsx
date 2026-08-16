import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Users,
  BookOpen,
  FileText,
  Plus,
  Trash2,
  Pencil,
  Database,
  Copy,
  LogOut,
  Sparkles,
  Search,
  Loader2,
  AlertTriangle,
  X,
  Save,
} from 'lucide-react'
import { YEARS, GOVERNORATES } from '../data/dummyData'
import {
  isSupabaseConfigured,
  SUPABASE_SQL_SCHEMA,
  fetchLessonsFromSupabase,
  createLessonInSupabase,
  updateLessonInSupabase,
  deleteLessonFromSupabase,
  fetchPastExamsFromSupabase,
  createPastExamInSupabase,
  updatePastExamInSupabase,
  deletePastExamFromSupabase,
  fetchStudentsFromSupabase,
  updateStudentInSupabase,
  toggleStudentActiveInSupabase,
} from '../lib/supabase'

const EMPTY_LESSON = {
  title: '',
  yearId: '3',
  semester: 1,
  branch: 'الكهربية والمغناطيسية',
  unit: 'الوحدة الأولى',
  duration: '45 دقيقة',
  videoUrl: '',
  isFree: true,
  summaryPdfName: '',
  description: '',
}

const EMPTY_EXAM = {
  title: '',
  yearId: '3',
  governorate: 'القاهرة',
  yearNum: '2024',
  semester: 1,
  branch: 'الكهربية والمغناطيسية',
  pdfName: '',
  videoSolutionUrl: '',
}

export default function AdminDashboardPage() {
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState('overview') // 'overview' | 'lessons' | 'exams' | 'students'
  const [showSqlModal, setShowSqlModal] = useState(false)
  const [sqlCopied, setSqlCopied] = useState(false)
  const [configured] = useState(isSupabaseConfigured())

  // Real data from Supabase
  const [lessonsList, setLessonsList] = useState([])
  const [examsList, setExamsList] = useState([])
  const [studentsList, setStudentsList] = useState([])

  // Loading / submitting states
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [isSubmittingLesson, setIsSubmittingLesson] = useState(false)
  const [isSubmittingExam, setIsSubmittingExam] = useState(false)
  const [isSubmittingStudent, setIsSubmittingStudent] = useState(false)
  const [deletingId, setDeletingId] = useState(null)

  // New Lesson Form state
  const [newLesson, setNewLesson] = useState(EMPTY_LESSON)

  // New Exam Form state
  const [newExam, setNewExam] = useState(EMPTY_EXAM)

  // Edit modals state — null means closed, otherwise holds the record being edited
  const [editingLesson, setEditingLesson] = useState(null)
  const [editingExam, setEditingExam] = useState(null)
  const [editingStudent, setEditingStudent] = useState(null)

  const [searchStudent, setSearchStudent] = useState('')

  // Load everything from Supabase on mount
  useEffect(() => {
    loadAllData()
  }, [])

  const loadAllData = async () => {
    setIsLoading(true)
    setLoadError('')
    try {
      const [lessons, exams, students] = await Promise.all([
        fetchLessonsFromSupabase(),
        fetchPastExamsFromSupabase(),
        fetchStudentsFromSupabase(),
      ])
      setLessonsList(lessons)
      setExamsList(exams)
      setStudentsList(students)
    } catch (err) {
      console.error(err)
      setLoadError('حدث خطأ أثناء تحميل البيانات من قاعدة البيانات.')
    } finally {
      setIsLoading(false)
    }
  }

  const handleLogout = () => {
    localStorage.removeItem('isAdminAuthenticated')
    navigate('/')
  }

  // ---------------- LESSONS: CREATE ----------------
  const handleAddLesson = async (e) => {
    e.preventDefault()
    if (!newLesson.title || !newLesson.videoUrl) {
      alert('يرجى إدخال عنوان الدرس ورابط الفيديو الخارجي')
      return
    }
    if (!configured) {
      alert('لسه معملتش ربط بـ Supabase، افتح "كود Supabase SQL" للتعليمات.')
      return
    }

    setIsSubmittingLesson(true)
    try {
      await createLessonInSupabase(newLesson)
      await loadAllData()
      alert('تم إضافة الدرس بنجاح ونشره بالمنصة!')
      setNewLesson(EMPTY_LESSON)
    } catch (err) {
      console.error(err)
      alert('حصل خطأ أثناء إضافة الدرس، حاول تاني.')
    } finally {
      setIsSubmittingLesson(false)
    }
  }

  // ---------------- LESSONS: UPDATE ----------------
  const handleUpdateLesson = async (e) => {
    e.preventDefault()
    if (!editingLesson.title || !editingLesson.videoUrl) {
      alert('يرجى إدخال عنوان الدرس ورابط الفيديو الخارجي')
      return
    }

    setIsSubmittingLesson(true)
    try {
      await updateLessonInSupabase(editingLesson.id, editingLesson)
      await loadAllData()
      setEditingLesson(null)
    } catch (err) {
      console.error(err)
      alert('حصل خطأ أثناء تعديل الدرس، حاول تاني.')
    } finally {
      setIsSubmittingLesson(false)
    }
  }

  const handleDeleteLesson = async (id) => {
    if (!confirm('هل أنت تأكد من حذف هذا الدرس؟')) return
    setDeletingId(id)
    try {
      await deleteLessonFromSupabase(id)
      setLessonsList((prev) => prev.filter((l) => l.id !== id))
    } catch (err) {
      console.error(err)
      alert('حصل خطأ أثناء حذف الدرس.')
    } finally {
      setDeletingId(null)
    }
  }

  // ---------------- EXAMS: CREATE ----------------
  const handleAddExam = async (e) => {
    e.preventDefault()
    if (!newExam.title) {
      alert('يرجى إدخال عنوان الامتحان')
      return
    }
    if (!configured) {
      alert('لسه معملتش ربط بـ Supabase، افتح "كود Supabase SQL" للتعليمات.')
      return
    }

    setIsSubmittingExam(true)
    try {
      await createPastExamInSupabase(newExam)
      await loadAllData()
      alert('تم إضافة الامتحان بنجاح!')
      setNewExam(EMPTY_EXAM)
    } catch (err) {
      console.error(err)
      alert('حصل خطأ أثناء إضافة الامتحان.')
    } finally {
      setIsSubmittingExam(false)
    }
  }

  // ---------------- EXAMS: UPDATE ----------------
  const handleUpdateExam = async (e) => {
    e.preventDefault()
    if (!editingExam.title) {
      alert('يرجى إدخال عنوان الامتحان')
      return
    }

    setIsSubmittingExam(true)
    try {
      await updatePastExamInSupabase(editingExam.id, editingExam)
      await loadAllData()
      setEditingExam(null)
    } catch (err) {
      console.error(err)
      alert('حصل خطأ أثناء تعديل الامتحان، حاول تاني.')
    } finally {
      setIsSubmittingExam(false)
    }
  }

  const handleDeleteExam = async (id) => {
    if (!confirm('هل أنت تأكد من حذف هذا الامتحان؟')) return
    setDeletingId(id)
    try {
      await deletePastExamFromSupabase(id)
      setExamsList((prev) => prev.filter((e) => e.id !== id))
    } catch (err) {
      console.error(err)
      alert('حصل خطأ أثناء حذف الامتحان.')
    } finally {
      setDeletingId(null)
    }
  }

  // ---------------- STUDENTS ----------------
  const toggleStudentStatus = async (id, currentStatus) => {
    try {
      await toggleStudentActiveInSupabase(id, currentStatus)
      setStudentsList((prev) =>
        prev.map((s) => (s.id === id ? { ...s, isActive: !currentStatus } : s))
      )
    } catch (err) {
      console.error(err)
      alert('حصل خطأ أثناء تحديث حالة الطالب.')
    }
  }

  const handleUpdateStudent = async (e) => {
    e.preventDefault()
    if (!editingStudent.name || !editingStudent.phone || !editingStudent.parentPhone) {
      alert('يرجى ملء اسم الطالب ورقمي الهاتف')
      return
    }

    setIsSubmittingStudent(true)
    try {
      await updateStudentInSupabase(editingStudent.id, editingStudent)
      await loadAllData()
      setEditingStudent(null)
    } catch (err) {
      console.error(err)
      alert('حصل خطأ أثناء تعديل بيانات الطالب، حاول تاني.')
    } finally {
      setIsSubmittingStudent(false)
    }
  }

  const copySqlToClipboard = () => {
    navigator.clipboard.writeText(SUPABASE_SQL_SCHEMA)
    setSqlCopied(true)
    setTimeout(() => setSqlCopied(false), 2000)
  }

  const filteredStudents = studentsList.filter(
    (s) =>
      s.name.toLowerCase().includes(searchStudent.toLowerCase()) ||
      s.phone.includes(searchStudent)
  )

  return (
    <div className="min-h-screen py-8 px-4 sm:px-8 max-w-7xl mx-auto space-y-8 font-ibm">
      {/* Header & Admin Bar */}
      <div className="bg-white dark:bg-gray-800 rounded-3xl p-6 sm:p-8 border border-slate-200 dark:border-gray-700 shadow-md flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-yellow-500 to-yellow-400 text-black flex items-center justify-center font-bold text-2xl shadow-lg">
            👑
          </div>
          <div>
            <h1 className="text-2xl font-bold font-messiri text-gray-900 dark:text-white">
              لوحة إدارة منصة مستر إسلام
            </h1>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              إدارة الدروس والفيديوهات، امتحانات السنين السابقة، وقاعدة بيانات الطلاب
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowSqlModal(true)}
            className="px-4 py-2.5 rounded-xl bg-purple-50 dark:bg-purple-950/60 border border-purple-200 dark:border-purple-800 text-purple-700 dark:text-purple-300 text-xs font-bold flex items-center gap-2 hover:bg-purple-100 transition"
          >
            <Database className="w-4 h-4" />
            <span>كود Supabase SQL</span>
          </button>

          <button
            onClick={handleLogout}
            className="px-4 py-2.5 rounded-xl bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-300 text-xs font-bold flex items-center gap-2 hover:bg-red-100 transition"
          >
            <LogOut className="w-4 h-4" />
            <span>تسجيل الخروج</span>
          </button>
        </div>
      </div>

      {/* Supabase connection indicator banner */}
      <div className="p-4 rounded-2xl bg-slate-100 dark:bg-gray-800/80 border border-slate-200 dark:border-gray-700 flex items-center justify-between text-xs">
        <div className="flex items-center gap-2 font-bold">
          <Database className="w-4 h-4 text-yellow-500" />
          <span>حالة اتصال Supabase:</span>
          {configured ? (
            <span className="px-2.5 py-0.5 rounded-md bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300">
              متصل بجداول Supabase المباشرة 🟢
            </span>
          ) : (
            <span className="px-2.5 py-0.5 rounded-md bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300">
              غير متصل — لازم تضيف مفاتيح Supabase في .env 🔴
            </span>
          )}
        </div>
        <button
          onClick={() => setShowSqlModal(true)}
          className="text-yellow-600 dark:text-yellow-400 font-bold hover:underline"
        >
          عرض تعليمات الربط
        </button>
      </div>

      {loadError && (
        <div className="p-4 rounded-2xl bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 flex items-center gap-2 text-xs text-red-700 dark:text-red-300 font-bold">
          <AlertTriangle className="w-4 h-4" />
          <span>{loadError}</span>
        </div>
      )}

      {/* Admin Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-slate-200 dark:border-gray-800 pb-2">
        <button
          onClick={() => setActiveTab('overview')}
          className={`px-5 py-2.5 rounded-xl font-bold text-sm transition flex items-center gap-2 ${activeTab === 'overview'
            ? 'bg-yellow-400 text-black shadow'
            : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-yellow-50'
            }`}
        >
          <Sparkles className="w-4 h-4" />
          <span>الإحصائيات العامة</span>
        </button>

        <button
          onClick={() => setActiveTab('lessons')}
          className={`px-5 py-2.5 rounded-xl font-bold text-sm transition flex items-center gap-2 ${activeTab === 'lessons'
            ? 'bg-yellow-400 text-black shadow'
            : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-yellow-50'
            }`}
        >
          <BookOpen className="w-4 h-4" />
          <span>إدارة الدروس والفيديوهات ({lessonsList.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('exams')}
          className={`px-5 py-2.5 rounded-xl font-bold text-sm transition flex items-center gap-2 ${activeTab === 'exams'
            ? 'bg-yellow-400 text-black shadow'
            : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-yellow-50'
            }`}
        >
          <FileText className="w-4 h-4" />
          <span>إدارة امتحانات المحافظات ({examsList.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('students')}
          className={`px-5 py-2.5 rounded-xl font-bold text-sm transition flex items-center gap-2 ${activeTab === 'students'
            ? 'bg-yellow-400 text-black shadow'
            : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-yellow-50'
            }`}
        >
          <Users className="w-4 h-4" />
          <span>إدارة الطلاب ({studentsList.length})</span>
        </button>
      </div>

      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-24 gap-3 text-gray-500">
          <Loader2 className="w-8 h-8 animate-spin text-yellow-500" />
          <span className="text-sm font-bold">جاري تحميل البيانات من قاعدة البيانات...</span>
        </div>
      ) : (
        <>
          {/* Tab 1: OVERVIEW */}
          {activeTab === 'overview' && (
            <div className="space-y-8">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                <div className="p-6 rounded-3xl bg-white dark:bg-gray-800 border border-slate-200 dark:border-gray-700 shadow-sm space-y-2">
                  <div className="text-xs text-gray-500 font-bold">إجمالي الطلاب المسجلين</div>
                  <div className="text-3xl font-bold text-yellow-500">{studentsList.length}</div>
                </div>
                <div className="p-6 rounded-3xl bg-white dark:bg-gray-800 border border-slate-200 dark:border-gray-700 shadow-sm space-y-2">
                  <div className="text-xs text-gray-500 font-bold">إجمالي دروس المنصة</div>
                  <div className="text-3xl font-bold text-emerald-600">{lessonsList.length} درس</div>
                </div>
                <div className="p-6 rounded-3xl bg-white dark:bg-gray-800 border border-slate-200 dark:border-gray-700 shadow-sm space-y-2">
                  <div className="text-xs text-gray-500 font-bold">امتحانات السنين السابقة</div>
                  <div className="text-3xl font-bold text-amber-500">{examsList.length} نموذج</div>
                </div>
                <div className="p-6 rounded-3xl bg-white dark:bg-gray-800 border border-slate-200 dark:border-gray-700 shadow-sm space-y-2">
                  <div className="text-xs text-gray-500 font-bold">الطلاب المفعّلين</div>
                  <div className="text-3xl font-bold text-purple-600">
                    {studentsList.filter((s) => s.isActive).length}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Tab 2: LESSONS MANAGEMENT */}
          {activeTab === 'lessons' && (
            <div className="space-y-8">
              {/* Add Lesson Form */}
              <div className="bg-white dark:bg-gray-800 rounded-3xl p-6 sm:p-8 border border-slate-200 dark:border-gray-700 shadow-sm space-y-6">
                <div className="flex items-center gap-2 font-bold text-lg text-gray-900 dark:text-white">
                  <Plus className="w-5 h-5 text-yellow-500" />
                  <span>إضافة درس جديد وفيديو محمي</span>
                </div>

                <form onSubmit={handleAddLesson} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                      عنوان الدرس
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="مثال: درس (1) حاصل الضرب الديكارتي"
                      value={newLesson.title}
                      onChange={(e) => setNewLesson({ ...newLesson, title: e.target.value })}
                      className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-gray-700 bg-slate-50 dark:bg-gray-900 text-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                      الصف الدراسي
                    </label>
                    <select
                      value={newLesson.yearId}
                      onChange={(e) => setNewLesson({ ...newLesson, yearId: e.target.value })}
                      className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-gray-700 bg-slate-50 dark:bg-gray-900 text-sm"
                    >
                      {YEARS.map((y) => (
                        <option key={y.id} value={y.id}>
                          {y.title}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                      الفرع (مثلاً: الجبر، الهندسة، الإحصاء...)
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="الجبر والإحصاء"
                      value={newLesson.branch}
                      onChange={(e) => setNewLesson({ ...newLesson, branch: e.target.value })}
                      className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-gray-700 bg-slate-50 dark:bg-gray-900 text-sm"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                      رابط الفيديو المحمي (Google Drive / YouTube / MP4 Direct Link) 🔒
                    </label>
                    <input
                      type="url"
                      required
                      placeholder="https://www.youtube.com/embed/dQw4w9WgXcQ"
                      value={newLesson.videoUrl}
                      onChange={(e) => setNewLesson({ ...newLesson, videoUrl: e.target.value })}
                      className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-gray-700 bg-slate-50 dark:bg-gray-900 text-sm font-mono"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                      اسم ملخص الدرس (PDF)
                    </label>
                    <input
                      type="text"
                      placeholder="ملخص_الدرس.pdf"
                      value={newLesson.summaryPdfName}
                      onChange={(e) => setNewLesson({ ...newLesson, summaryPdfName: e.target.value })}
                      className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-gray-700 bg-slate-50 dark:bg-gray-900 text-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                      مدة الدرس (مثلاً: 45 دقيقة)
                    </label>
                    <input
                      type="text"
                      placeholder="45 دقيقة"
                      value={newLesson.duration}
                      onChange={(e) => setNewLesson({ ...newLesson, duration: e.target.value })}
                      className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-gray-700 bg-slate-50 dark:bg-gray-900 text-sm"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <button
                      type="submit"
                      disabled={isSubmittingLesson}
                      className="px-6 py-3 rounded-xl bg-yellow-400 hover:bg-yellow-300 disabled:opacity-60 disabled:cursor-not-allowed text-black font-bold text-sm shadow transition flex items-center gap-2"
                    >
                      {isSubmittingLesson && <Loader2 className="w-4 h-4 animate-spin" />}
                      <span>{isSubmittingLesson ? 'جاري الحفظ...' : 'حفظ ونشر الدرس'}</span>
                    </button>
                  </div>
                </form>
              </div>

              {/* Lessons List Table */}
              <div className="bg-white dark:bg-gray-800 rounded-3xl p-6 border border-slate-200 dark:border-gray-700 shadow-sm space-y-4">
                <h3 className="font-bold text-lg text-gray-900 dark:text-white">قائمة دروس المنصة الحاليّة</h3>
                {lessonsList.length === 0 ? (
                  <p className="text-xs text-gray-500 text-center py-8">لا توجد دروس مضافة بعد.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm text-right">
                      <thead className="bg-slate-100 dark:bg-gray-900 text-xs font-bold text-gray-600 dark:text-gray-400">
                        <tr>
                          <th className="p-3">عنوان الدرس</th>
                          <th className="p-3">الصف الدراسي</th>
                          <th className="p-3">الفرع</th>
                          <th className="p-3">الرابط</th>
                          <th className="p-3">إجراءات</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-gray-700">
                        {lessonsList.map((lesson) => (
                          <tr key={lesson.id} className="hover:bg-slate-50 dark:hover:bg-gray-700/50">
                            <td className="p-3 font-bold text-gray-900 dark:text-white">{lesson.title}</td>
                            <td className="p-3 text-xs">{YEARS.find((y) => y.id === lesson.yearId)?.title || 'عام'}</td>
                            <td className="p-3 text-xs">{lesson.branch}</td>
                            <td className="p-3 text-xs font-mono truncate max-w-[200px]">{lesson.videoUrl}</td>
                            <td className="p-3">
                              <div className="flex items-center gap-1.5">
                                <button
                                  onClick={() => setEditingLesson({ ...lesson })}
                                  className="p-1.5 rounded-lg bg-yellow-50 text-yellow-600 hover:bg-yellow-100 text-xs flex items-center gap-1"
                                >
                                  <Pencil className="w-4 h-4" />
                                  <span>تعديل</span>
                                </button>
                                <button
                                  onClick={() => handleDeleteLesson(lesson.id)}
                                  disabled={deletingId === lesson.id}
                                  className="p-1.5 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 disabled:opacity-50 text-xs flex items-center gap-1"
                                >
                                  {deletingId === lesson.id ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                  ) : (
                                    <Trash2 className="w-4 h-4" />
                                  )}
                                  <span>حذف</span>
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Tab 3: EXAMS MANAGEMENT */}
          {activeTab === 'exams' && (
            <div className="space-y-8">
              <div className="bg-white dark:bg-gray-800 rounded-3xl p-6 sm:p-8 border border-slate-200 dark:border-gray-700 shadow-sm space-y-6">
                <div className="flex items-center gap-2 font-bold text-lg text-gray-900 dark:text-white">
                  <Plus className="w-5 h-5 text-amber-500" />
                  <span>إضافة امتحان محافظة جديد</span>
                </div>

                <form onSubmit={handleAddExam} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                      عنوان الامتحان
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="امتحان محافظة القاهرة 2024 - جبر وإحصاء"
                      value={newExam.title}
                      onChange={(e) => setNewExam({ ...newExam, title: e.target.value })}
                      className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-gray-700 bg-slate-50 dark:bg-gray-900 text-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                      المحافظة
                    </label>
                    <select
                      value={newExam.governorate}
                      onChange={(e) => setNewExam({ ...newExam, governorate: e.target.value })}
                      className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-gray-700 bg-slate-50 dark:bg-gray-900 text-sm"
                    >
                      {GOVERNORATES.map((g) => (
                        <option key={g} value={g}>
                          {g}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                      سنة الامتحان
                    </label>
                    <input
                      type="text"
                      value={newExam.yearNum}
                      onChange={(e) => setNewExam({ ...newExam, yearNum: e.target.value })}
                      className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-gray-700 bg-slate-50 dark:bg-gray-900 text-sm"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <button
                      type="submit"
                      disabled={isSubmittingExam}
                      className="px-6 py-3 rounded-xl bg-amber-500 hover:bg-amber-600 disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold text-sm shadow transition flex items-center gap-2"
                    >
                      {isSubmittingExam && <Loader2 className="w-4 h-4 animate-spin" />}
                      <span>{isSubmittingExam ? 'جاري الحفظ...' : 'حفظ ونشر الامتحان'}</span>
                    </button>
                  </div>
                </form>
              </div>

              {/* Exams List Table */}
              <div className="bg-white dark:bg-gray-800 rounded-3xl p-6 border border-slate-200 dark:border-gray-700 shadow-sm space-y-4">
                <h3 className="font-bold text-lg text-gray-900 dark:text-white">قائمة الامتحانات الحاليّة</h3>
                {examsList.length === 0 ? (
                  <p className="text-xs text-gray-500 text-center py-8">لا توجد امتحانات مضافة بعد.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm text-right">
                      <thead className="bg-slate-100 dark:bg-gray-900 text-xs font-bold text-gray-600 dark:text-gray-400">
                        <tr>
                          <th className="p-3">عنوان الامتحان</th>
                          <th className="p-3">المحافظة</th>
                          <th className="p-3">السنة</th>
                          <th className="p-3">إجراءات</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-gray-700">
                        {examsList.map((exam) => (
                          <tr key={exam.id} className="hover:bg-slate-50 dark:hover:bg-gray-700/50">
                            <td className="p-3 font-bold text-gray-900 dark:text-white">{exam.title}</td>
                            <td className="p-3 text-xs">{exam.governorate}</td>
                            <td className="p-3 text-xs">{exam.year}</td>
                            <td className="p-3">
                              <div className="flex items-center gap-1.5">
                                <button
                                  onClick={() => setEditingExam({ ...exam, yearNum: exam.year })}
                                  className="p-1.5 rounded-lg bg-yellow-50 text-yellow-600 hover:bg-yellow-100 text-xs flex items-center gap-1"
                                >
                                  <Pencil className="w-4 h-4" />
                                  <span>تعديل</span>
                                </button>
                                <button
                                  onClick={() => handleDeleteExam(exam.id)}
                                  disabled={deletingId === exam.id}
                                  className="p-1.5 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 disabled:opacity-50 text-xs flex items-center gap-1"
                                >
                                  {deletingId === exam.id ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                  ) : (
                                    <Trash2 className="w-4 h-4" />
                                  )}
                                  <span>حذف</span>
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Tab 4: STUDENTS MANAGEMENT */}
          {activeTab === 'students' && (
            <div className="bg-white dark:bg-gray-800 rounded-3xl p-6 border border-slate-200 dark:border-gray-700 shadow-sm space-y-6">
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                <h3 className="font-bold text-lg text-gray-900 dark:text-white">جدول الطلاب المسجلين بالمنصة</h3>
                <div className="relative w-full sm:w-72">
                  <input
                    type="text"
                    placeholder="ابحث باسم الطالب أو رقم الهاتف..."
                    value={searchStudent}
                    onChange={(e) => setSearchStudent(e.target.value)}
                    className="w-full px-4 py-2 pr-9 rounded-xl border border-slate-200 dark:border-gray-700 bg-slate-50 dark:bg-gray-900 text-xs"
                  />
                  <Search className="w-4 h-4 absolute top-2.5 right-3 text-gray-400" />
                </div>
              </div>

              {filteredStudents.length === 0 ? (
                <p className="text-xs text-gray-500 text-center py-8">لا يوجد طلاب مطابقين.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-right">
                    <thead className="bg-slate-100 dark:bg-gray-900 text-xs font-bold text-gray-600 dark:text-gray-400">
                      <tr>
                        <th className="p-3">اسم الطالب</th>
                        <th className="p-3">رقم هاتف الطالب</th>
                        <th className="p-3">رقم ولي الأمر</th>
                        <th className="p-3">الصف</th>
                        <th className="p-3">المحافظة</th>
                        <th className="p-3">الحالة</th>
                        <th className="p-3">الإجراءات</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-gray-700">
                      {filteredStudents.map((s) => (
                        <tr key={s.id} className="hover:bg-slate-50 dark:hover:bg-gray-700/50">
                          <td className="p-3 font-bold text-gray-900 dark:text-white">{s.name}</td>
                          <td className="p-3 text-xs dir-ltr text-right">{s.phone}</td>
                          <td className="p-3 text-xs dir-ltr text-right">{s.parentPhone}</td>
                          <td className="p-3 text-xs">{YEARS.find((y) => y.id === s.yearId)?.title}</td>
                          <td className="p-3 text-xs">{s.governorate}</td>
                          <td className="p-3 text-xs">
                            {s.isActive ? (
                              <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-700 font-bold">مفعل 🟢</span>
                            ) : (
                              <span className="px-2 py-0.5 rounded bg-red-100 text-red-700 font-bold">موقوف 🔴</span>
                            )}
                          </td>
                          <td className="p-3">
                            <div className="flex items-center gap-3">
                              <button
                                onClick={() => setEditingStudent({ ...s })}
                                className="text-xs font-bold text-yellow-600 hover:underline flex items-center gap-1"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                                <span>تعديل</span>
                              </button>
                              <button
                                onClick={() => toggleStudentStatus(s.id, s.isActive)}
                                className="text-xs font-bold text-amber-600 hover:underline"
                              >
                                {s.isActive ? 'إيقاف الحساب' : 'تنشيط الحساب'}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* ============== EDIT LESSON MODAL ============== */}
      {editingLesson && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-900 rounded-3xl p-6 sm:p-8 max-w-2xl w-full space-y-4 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-lg text-gray-900 dark:text-white flex items-center gap-2">
                <Pencil className="w-5 h-5 text-yellow-500" />
                <span>تعديل الدرس</span>
              </h3>
              <button onClick={() => setEditingLesson(null)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleUpdateLesson} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">عنوان الدرس</label>
                <input
                  type="text"
                  required
                  value={editingLesson.title}
                  onChange={(e) => setEditingLesson({ ...editingLesson, title: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-gray-700 bg-slate-50 dark:bg-gray-900 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">الصف الدراسي</label>
                <select
                  value={editingLesson.yearId}
                  onChange={(e) => setEditingLesson({ ...editingLesson, yearId: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-gray-700 bg-slate-50 dark:bg-gray-900 text-sm"
                >
                  {YEARS.map((y) => (
                    <option key={y.id} value={y.id}>
                      {y.title}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">الفرع</label>
                <input
                  type="text"
                  required
                  value={editingLesson.branch}
                  onChange={(e) => setEditingLesson({ ...editingLesson, branch: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-gray-700 bg-slate-50 dark:bg-gray-900 text-sm"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">رابط الفيديو الخارجي</label>
                <input
                  type="url"
                  required
                  value={editingLesson.videoUrl}
                  onChange={(e) => setEditingLesson({ ...editingLesson, videoUrl: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-gray-700 bg-slate-50 dark:bg-gray-900 text-sm font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">اسم ملخص الدرس (PDF)</label>
                <input
                  type="text"
                  value={editingLesson.summaryPdfName || ''}
                  onChange={(e) => setEditingLesson({ ...editingLesson, summaryPdfName: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-gray-700 bg-slate-50 dark:bg-gray-900 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">مدة الدرس</label>
                <input
                  type="text"
                  value={editingLesson.duration}
                  onChange={(e) => setEditingLesson({ ...editingLesson, duration: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-gray-700 bg-slate-50 dark:bg-gray-900 text-sm"
                />
              </div>

              <div className="sm:col-span-2 flex gap-3">
                <button
                  type="submit"
                  disabled={isSubmittingLesson}
                  className="flex-1 px-6 py-3 rounded-xl bg-yellow-400 hover:bg-yellow-300 disabled:opacity-60 text-black font-bold text-sm shadow transition flex items-center justify-center gap-2"
                >
                  {isSubmittingLesson ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  <span>{isSubmittingLesson ? 'جاري الحفظ...' : 'حفظ التعديلات'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setEditingLesson(null)}
                  className="px-6 py-3 rounded-xl bg-slate-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 font-bold text-sm transition"
                >
                  إلغاء
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============== EDIT EXAM MODAL ============== */}
      {editingExam && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-900 rounded-3xl p-6 sm:p-8 max-w-2xl w-full space-y-4 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-lg text-gray-900 dark:text-white flex items-center gap-2">
                <Pencil className="w-5 h-5 text-amber-500" />
                <span>تعديل الامتحان</span>
              </h3>
              <button onClick={() => setEditingExam(null)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleUpdateExam} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">عنوان الامتحان</label>
                <input
                  type="text"
                  required
                  value={editingExam.title}
                  onChange={(e) => setEditingExam({ ...editingExam, title: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-gray-700 bg-slate-50 dark:bg-gray-900 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">المحافظة</label>
                <select
                  value={editingExam.governorate}
                  onChange={(e) => setEditingExam({ ...editingExam, governorate: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-gray-700 bg-slate-50 dark:bg-gray-900 text-sm"
                >
                  {GOVERNORATES.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">سنة الامتحان</label>
                <input
                  type="text"
                  value={editingExam.yearNum}
                  onChange={(e) => setEditingExam({ ...editingExam, yearNum: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-gray-700 bg-slate-50 dark:bg-gray-900 text-sm"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">رابط فيديو الحل (اختياري)</label>
                <input
                  type="url"
                  value={editingExam.videoSolutionUrl || ''}
                  onChange={(e) => setEditingExam({ ...editingExam, videoSolutionUrl: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-gray-700 bg-slate-50 dark:bg-gray-900 text-sm font-mono"
                />
              </div>

              <div className="sm:col-span-2 flex gap-3">
                <button
                  type="submit"
                  disabled={isSubmittingExam}
                  className="flex-1 px-6 py-3 rounded-xl bg-amber-500 hover:bg-amber-600 disabled:opacity-60 text-white font-bold text-sm shadow transition flex items-center justify-center gap-2"
                >
                  {isSubmittingExam ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  <span>{isSubmittingExam ? 'جاري الحفظ...' : 'حفظ التعديلات'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setEditingExam(null)}
                  className="px-6 py-3 rounded-xl bg-slate-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 font-bold text-sm transition"
                >
                  إلغاء
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============== EDIT STUDENT MODAL ============== */}
      {editingStudent && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-900 rounded-3xl p-6 sm:p-8 max-w-lg w-full space-y-4 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-lg text-gray-900 dark:text-white flex items-center gap-2">
                <Pencil className="w-5 h-5 text-purple-600" />
                <span>تعديل بيانات الطالب</span>
              </h3>
              <button onClick={() => setEditingStudent(null)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleUpdateStudent} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">اسم الطالب</label>
                <input
                  type="text"
                  required
                  value={editingStudent.name}
                  onChange={(e) => setEditingStudent({ ...editingStudent, name: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-gray-700 bg-slate-50 dark:bg-gray-900 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">رقم هاتف الطالب</label>
                <input
                  type="tel"
                  required
                  dir="ltr"
                  value={editingStudent.phone}
                  onChange={(e) => setEditingStudent({ ...editingStudent, phone: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-gray-700 bg-slate-50 dark:bg-gray-900 text-sm text-right"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">رقم هاتف ولي الأمر</label>
                <input
                  type="tel"
                  required
                  dir="ltr"
                  value={editingStudent.parentPhone}
                  onChange={(e) => setEditingStudent({ ...editingStudent, parentPhone: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-gray-700 bg-slate-50 dark:bg-gray-900 text-sm text-right"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">الصف الدراسي</label>
                <select
                  value={editingStudent.yearId}
                  onChange={(e) => setEditingStudent({ ...editingStudent, yearId: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-gray-700 bg-slate-50 dark:bg-gray-900 text-sm"
                >
                  {YEARS.map((y) => (
                    <option key={y.id} value={y.id}>
                      {y.title}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">المحافظة</label>
                <select
                  value={editingStudent.governorate}
                  onChange={(e) => setEditingStudent({ ...editingStudent, governorate: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-gray-700 bg-slate-50 dark:bg-gray-900 text-sm"
                >
                  {GOVERNORATES.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              </div>

              <div className="sm:col-span-2 flex gap-3">
                <button
                  type="submit"
                  disabled={isSubmittingStudent}
                  className="flex-1 px-6 py-3 rounded-xl bg-purple-600 hover:bg-purple-700 disabled:opacity-60 text-white font-bold text-sm shadow transition flex items-center justify-center gap-2"
                >
                  {isSubmittingStudent ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  <span>{isSubmittingStudent ? 'جاري الحفظ...' : 'حفظ التعديلات'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setEditingStudent(null)}
                  className="px-6 py-3 rounded-xl bg-slate-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 font-bold text-sm transition"
                >
                  إلغاء
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Supabase SQL Schema Modal */}
      {showSqlModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-900 rounded-3xl p-6 sm:p-8 max-w-2xl w-full space-y-4 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-lg text-gray-900 dark:text-white flex items-center gap-2">
                <Database className="w-5 h-5 text-yellow-500" />
                <span>كود إعداد جداول Supabase جاهز للتشغيل</span>
              </h3>
              <button onClick={() => setShowSqlModal(false)} className="text-gray-400 hover:text-gray-600">
                ✕
              </button>
            </div>

            <p className="text-xs text-gray-600 dark:text-gray-400">
              قم بفتح حسابك في موقع Supabase وحدد مشروعك، ثم اذهب إلى **SQL Editor** وانسخ هذا الكود لتشغيله وإنشاء كافة الجداول فوراً. وبعد كده لازم تضيف <code>VITE_SUPABASE_URL</code> و <code>VITE_SUPABASE_ANON_KEY</code> في ملف <code>.env</code> بتاعك.
            </p>

            <div className="relative">
              <pre className="p-4 rounded-xl bg-gray-950 text-emerald-400 font-mono text-xs overflow-x-auto dir-ltr">
                {SUPABASE_SQL_SCHEMA}
              </pre>
              <button
                onClick={copySqlToClipboard}
                className="absolute top-3 left-3 px-3 py-1.5 rounded-lg bg-yellow-400 text-black text-xs font-bold flex items-center gap-1 hover:bg-yellow-300"
              >
                <Copy className="w-4 h-4" />
                <span>{sqlCopied ? 'تم النسخ! ✅' : 'نسخ الكود'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
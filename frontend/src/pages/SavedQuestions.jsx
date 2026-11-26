import { useCallback, useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Search, Sparkles } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Alert, Button, Card, Input, Select, StatusMessage } from '../components/ui'
import DeleteSavedSetModal from '../components/saved/DeleteSavedSetModal.jsx'
import SavedSetList, { SavedSetListSkeleton } from '../components/saved/SavedSetList.jsx'
import SavedSetViewModal from '../components/saved/SavedSetViewModal.jsx'
import useAuth from '../hooks/useAuth.js'
import useSavedSets from '../hooks/useSavedSets.js'
import useSetSources from '../hooks/useSetSources.js'
import { fetchAdminSavedSet } from '../services/savedQuestionService.js'
import { isAdmin } from '../utils/roles.js'
import { inferSource, SORT_OPTIONS } from '../utils/savedQuestions.js'

const PAGE_SIZE = 10
const SEARCH_DELAY_MS = 350
const SCOPE_OPTIONS = [
  { value: 'all', label: 'All students' },
  { value: 'mine', label: 'Only my sets' },
]

/**
 * Saved question sets (manual and generated from papers): list, view with answers, delete.
 * Students see their own. Admins see the sets of every student, read-only: the student's name and academic details are shown and
 * Delete is offered only for the admin's own sets (the backend has no route to delete or edit a student's set).
 */
function SavedQuestions() {
  const { user } = useAuth()
  const userId = user?._id || user?.id || ''
  const admin = isAdmin(user)

  const [searchText, setSearchText] = useState('')
  const [search, setSearch] = useState('') // the debounced value that is actually sent to the API
  const [sort, setSort] = useState('newest')
  const [scope, setScope] = useState('all') // admin only: 'all' students or only the admin's own sets
  const [page, setPage] = useState(1)
  const [modal, setModal] = useState(null) // { kind: 'view' | 'delete', set }
  const [notice, setNotice] = useState(null) // { variant: 'success' | 'error', text }

  const { items, meta, loading, refreshing, error, reload } = useSavedSets({
    q: search, sort, page, limit: PAGE_SIZE, admin, studentId: admin && scope === 'mine' ? userId : '',
  })
  // The origin label of a student's set is worked out when it is opened: looking inside every row would read every student's questions.
  const { sources, pending, remember, forget } = useSetSources(admin ? [] : items, userId)
  const filtered = Boolean(search) || (admin && scope === 'mine')

  // Wait for a pause in typing before searching.
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch((prev) => {
        const next = searchText.trim()
        if (next !== prev) setPage(1)
        return next
      })
    }, SEARCH_DELAY_MS)
    return () => clearTimeout(timer)
  }, [searchText])

  // Success messages fade away on their own.
  useEffect(() => {
    if (notice?.variant !== 'success') return undefined
    const timer = setTimeout(() => setNotice(null), 6000)
    return () => clearTimeout(timer)
  }, [notice])

  const closeModal = useCallback(() => setModal(null), [])
  const clearSearch = () => {
    setSearchText('')
    setSearch('')
    setScope('all')
    setPage(1)
  }

  // Opening a set shows its questions, which settles its origin for the list.
  const handleLoaded = useCallback((id, set) => {
    const source = inferSource(set?.questions)
    if (source) remember(id, source)
  }, [remember])

  const handleDeleted = (set, { alreadyGone = false } = {}) => {
    setModal(null)
    forget(set._id)
    setNotice({ variant: 'success', text: alreadyGone ? `“${set.title}” was already removed.` : `“${set.title}” was deleted.` })
    if (items.length === 1 && page > 1) setPage(page - 1) // the page just emptied: step back
    else reload()
  }

  const totalPages = meta?.totalPages ?? 1
  const generateButton = (
    <Link to="/generate-questions">
      <Button size="sm"><Sparkles size={16} aria-hidden="true" /> Generate questions</Button>
    </Link>
  )

  let content
  if (loading) {
    content = <SavedSetListSkeleton />
  } else if (error) {
    content = <StatusMessage state="error" title={admin ? 'Couldn’t load the saved questions' : 'Couldn’t load your saved questions'} text={error} onRetry={reload} />
  } else if (items.length === 0) {
    content = filtered ? (
      <div className="status status--empty">
        <p className="status__title">No matching sets</p>
        <p className="muted">{admin && scope === 'mine' && !search ? 'You have not saved any question sets yet.' : 'No saved set matches. Try a different search.'}</p>
        <Button size="sm" variant="outline" onClick={clearSearch}>Clear search</Button>
      </div>
    ) : (
      <div className="status status--empty">
        <p className="status__title">No saved question sets yet</p>
        <p className="muted">{admin ? 'No student has saved a question set yet.' : 'Generate questions from your papers, or type your own, then choose “Save question set” to keep them here.'}</p>
        {!admin && generateButton}
      </div>
    )
  } else {
    content = (
      <div className={refreshing ? 'is-refreshing' : undefined} aria-busy={refreshing}>
        <SavedSetList
          items={items}
          sources={sources}
          pending={pending}
          onView={(set) => setModal({ kind: 'view', set })}
          onDelete={(set) => setModal({ kind: 'delete', set })}
          userId={userId}
          showStudent={admin}
        />
        {totalPages > 1 && (
          <nav className="pager" aria-label="Pagination">
            <Button size="sm" variant="outline" onClick={() => setPage(page - 1)} disabled={page <= 1 || refreshing}>
              <ChevronLeft size={16} aria-hidden="true" /> Previous
            </Button>
            <span className="muted">Page {meta?.page ?? page} of {totalPages}</span>
            <Button size="sm" variant="outline" onClick={() => setPage(page + 1)} disabled={page >= totalPages || refreshing}>
              Next <ChevronRight size={16} aria-hidden="true" />
            </Button>
          </nav>
        )}
      </div>
    )
  }

  return (
    <>
      <header className="page-head">
        <h1 className="page-head__title">Saved questions</h1>
        <p className="muted">
          {admin
            ? 'Question sets saved by every student, with the student’s name and academic details. Open one to read its questions and AI answers. This view is read-only.'
            : 'Question sets you saved, whether generated from your uploaded papers or typed by you. Open one to read its questions and AI answers.'}
        </p>
      </header>

      {notice && <div className="section"><Alert variant={notice.variant}>{notice.text}</Alert></div>}

      <Card
        className="section"
        title={admin ? 'Saved sets of all students' : 'My saved sets'}
        subtitle={meta && !error ? `${meta.total} ${meta.total === 1 ? 'set' : 'sets'}${filtered ? ' found' : ''}` : undefined}
        actions={!admin && (items.length > 0 || filtered) ? generateButton : undefined}
      >
        <div className={`materials-toolbar saved-toolbar ${admin ? 'saved-toolbar--admin' : ''}`}>
          <div className="materials-toolbar__search">
            <Search size={16} aria-hidden="true" />
            <Input
              type="search"
              aria-label="Search saved sets"
              placeholder="Search by title"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              maxLength={100}
            />
          </div>
          <Select aria-label="Sort saved sets" value={sort} onChange={(e) => { setSort(e.target.value); setPage(1) }} options={SORT_OPTIONS} placeholder="Sort by" />
          {admin && (
            <Select aria-label="Filter by student" value={scope} onChange={(e) => { setScope(e.target.value); setPage(1) }} options={SCOPE_OPTIONS} placeholder="All students" />
          )}
        </div>
        {content}
      </Card>

      {modal?.kind === 'view' && (
        <SavedSetViewModal
          set={modal.set}
          source={sources[modal.set._id] ?? null}
          onClose={closeModal}
          onLoaded={handleLoaded}
          {...(admin ? { fetchSet: fetchAdminSavedSet, showStudent: true, userId } : {})}
        />
      )}
      {modal?.kind === 'delete' && (!admin || modal.set.student?._id === userId) && <DeleteSavedSetModal set={modal.set} onClose={closeModal} onDeleted={handleDeleted} />}
    </>
  )
}

export default SavedQuestions

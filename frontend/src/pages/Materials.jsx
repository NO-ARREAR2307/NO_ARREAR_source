import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Plus, Search } from 'lucide-react'
import { Alert, Button, Card, Input, Select, StatusMessage } from '../components/ui'
import DeleteMaterialModal from '../components/materials/DeleteMaterialModal.jsx'
import MaterialFormModal from '../components/materials/MaterialFormModal.jsx'
import MaterialList, { MaterialListSkeleton } from '../components/materials/MaterialList.jsx'
import ShareMaterialModal from '../components/materials/ShareMaterialModal.jsx'
import MaterialViewModal from '../components/materials/MaterialViewModal.jsx'
import useAuth from '../hooks/useAuth.js'
import useMaterials from '../hooks/useMaterials.js'
import { describeError, downloadMaterial } from '../services/materialService.js'
import { MATERIAL_TYPES, SORT_OPTIONS } from '../utils/materials.js'
import { isAdmin } from '../utils/roles.js'

const PAGE_SIZE = 10
const SEARCH_DELAY_MS = 350
const SCOPE_OPTIONS = [
  { value: 'all', label: 'All uploads' },
  { value: 'mine', label: 'Only my uploads' },
]

/** Study materials: upload, view, edit, delete and download. Students see their own; admins see everyone's. */
function Materials() {
  const { user } = useAuth()
  const admin = isAdmin(user)
  const userId = user?._id || user?.id || ''

  const [searchText, setSearchText] = useState('')
  const [search, setSearch] = useState('') // the debounced value that is actually sent to the API
  const [materialType, setMaterialType] = useState('')
  const [sort, setSort] = useState('newest')
  const [scope, setScope] = useState('all')
  const [page, setPage] = useState(1)

  const [modal, setModal] = useState(null) // { kind: 'upload' | 'view' | 'edit' | 'delete' | 'share', material? }
  const [notice, setNotice] = useState(null) // { variant: 'success' | 'error', text }
  const [busyId, setBusyId] = useState('')
  // Links created during this visit. The backend shows a link only once, so this lets the owner reopen the dialog and
  // copy it again. Memory only (never stored), gone on refresh or when leaving the page.
  const shareLinks = useRef({})

  const list = useMaterials({
    search, materialType, sort, page, limit: PAGE_SIZE,
    uploadedBy: admin && scope === 'mine' ? userId : '',
  })
  const { items, meta, loading, refreshing, error, reload } = list
  const filtered = Boolean(search || materialType || scope === 'mine')

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

  // Success messages fade away on their own; errors stay until the next action.
  useEffect(() => {
    if (notice?.variant !== 'success') return undefined
    const timer = setTimeout(() => setNotice(null), 6000)
    return () => clearTimeout(timer)
  }, [notice])

  const closeModal = useCallback(() => setModal(null), [])
  const changeFilter = (setter) => (e) => {
    setter(e.target.value)
    setPage(1)
  }
  const clearFilters = () => {
    setSearchText('')
    setSearch('')
    setMaterialType('')
    setScope('all')
    setPage(1)
  }

  const handleSaved = (_material, text) => {
    setModal(null)
    setNotice({ variant: 'success', text })
    if (text.includes('uploaded') && page !== 1) setPage(1) // newest first: show the new upload
    else reload()
    if (text.includes('uploaded') && sort !== 'newest') setSort('newest')
  }

  const handleDeleted = (material) => {
    setModal(null)
    setNotice({ variant: 'success', text: `“${material.title}” was deleted.` })
    if (items.length === 1 && page > 1) setPage(page - 1) // the page just emptied: step back
    else reload()
  }

  const handleShareLink = useCallback((id, url) => {
    if (url) shareLinks.current[id] = url
    else delete shareLinks.current[id]
  }, [])
  const handleShareChanged = useCallback((text) => {
    setNotice({ variant: 'success', text })
    reload()
  }, [reload])

  const handleDownload = async (material) => {
    setBusyId(material._id)
    setNotice(null)
    try {
      await downloadMaterial(material)
    } catch (err) {
      setNotice({ variant: 'error', text: describeError(err, 'Could not download the file.') })
    } finally {
      setBusyId('')
    }
  }

  const ownerOf = admin && userId ? (m) => (m.uploadedBy === userId ? 'You' : 'Student') : undefined
  const totalPages = meta?.totalPages ?? 1
  const uploadButton = (
    <Button onClick={() => setModal({ kind: 'upload' })}>
      <Plus size={16} aria-hidden="true" /> Upload material
    </Button>
  )

  let content
  if (loading) {
    content = <MaterialListSkeleton />
  } else if (error) {
    content = <StatusMessage state="error" title="Couldn’t load study materials" text={error} onRetry={reload} />
  } else if (items.length === 0) {
    content = filtered ? (
      <div className="status status--empty">
        <p className="status__title">No matching materials</p>
        <p className="muted">Try a different search or clear the filters.</p>
        <Button size="sm" variant="outline" onClick={clearFilters}>Clear filters</Button>
      </div>
    ) : (
      <div className="status status--empty">
        <p className="status__title">No study materials yet</p>
        <p className="muted">{admin ? 'Nothing has been uploaded yet.' : 'Upload notes, question papers or other files to keep them in one place.'}</p>
        {uploadButton}
      </div>
    )
  } else {
    content = (
      <div className={refreshing ? 'is-refreshing' : undefined} aria-busy={refreshing}>
        <MaterialList
          items={items}
          busyId={busyId}
          ownerOf={ownerOf}
          onView={(material) => setModal({ kind: 'view', material })}
          onDownload={handleDownload}
          onShare={(material) => setModal({ kind: 'share', material })}
          onEdit={(material) => setModal({ kind: 'edit', material })}
          onDelete={(material) => setModal({ kind: 'delete', material })}
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
        <h1 className="page-head__title">Study materials</h1>
        <p className="muted">
          {admin
            ? 'View, share, edit and delete every study material, or upload your own.'
            : 'Upload and manage your own study materials. They stay private until you create a share link.'}
        </p>
      </header>

      {notice && <div className="section"><Alert variant={notice.variant}>{notice.text}</Alert></div>}

      <Card
        className="section"
        title={admin ? 'All materials' : 'My materials'}
        subtitle={meta && !error ? `${meta.total} ${meta.total === 1 ? 'material' : 'materials'}${filtered ? ' found' : ''}` : undefined}
        actions={uploadButton}
      >
        <div className={`materials-toolbar ${admin ? 'materials-toolbar--admin' : ''}`}>
          <div className="materials-toolbar__search">
            <Search size={16} aria-hidden="true" />
            <Input
              type="search"
              aria-label="Search materials"
              placeholder="Search by title or file name"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              maxLength={100}
            />
          </div>
          <Select aria-label="Filter by type" value={materialType} onChange={changeFilter(setMaterialType)} options={MATERIAL_TYPES} placeholder="All types" />
          <Select aria-label="Sort materials" value={sort} onChange={changeFilter(setSort)} options={SORT_OPTIONS} placeholder="Sort by" />
          {admin && userId && (
            <Select aria-label="Filter by uploader" value={scope} onChange={changeFilter(setScope)} options={SCOPE_OPTIONS} placeholder="All uploads" />
          )}
        </div>
        {content}
      </Card>

      {modal?.kind === 'upload' && <MaterialFormModal onClose={closeModal} onSaved={handleSaved} />}
      {modal?.kind === 'edit' && <MaterialFormModal material={modal.material} onClose={closeModal} onSaved={handleSaved} />}
      {modal?.kind === 'view' && <MaterialViewModal material={modal.material} onClose={closeModal} />}
      {modal?.kind === 'share' && (
        <ShareMaterialModal
          material={modal.material}
          knownLink={shareLinks.current[modal.material._id] || ''}
          onLinkChange={handleShareLink}
          onChanged={handleShareChanged}
          onClose={closeModal}
        />
      )}
      {modal?.kind === 'delete' && <DeleteMaterialModal material={modal.material} onClose={closeModal} onDeleted={handleDeleted} />}
    </>
  )
}

export default Materials

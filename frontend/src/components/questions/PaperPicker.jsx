import { useEffect, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, FileImage, FileText, RotateCcw, Search, X } from 'lucide-react'
import { Button, Input, Select, StatusMessage } from '../ui'
import { MaterialListSkeleton } from '../materials/MaterialList.jsx'
import useMaterials from '../../hooks/useMaterials.js'
import { fileKindLabel, formatDate, formatSize, isImageMaterial, MATERIAL_TYPES, typeLabel, uploaderLabel } from '../../utils/materials.js'
import { MAX_PAPERS, extractionNote } from '../../utils/questionGeneration.js'

const PAGE_SIZE = 10
const SEARCH_DELAY_MS = 350

/**
 * The student's uploaded papers (GET /api/papers, the same list as Study materials) with checkboxes.
 * `selected` is { [id]: paper } so a choice survives paging and filtering. `uploadedBy` limits the list to one uploader's papers.
 * Admin view (`showUploader`): the list holds every student's uploads (the generator accepts any student's paper from an admin), each row
 * names who uploaded it, and `scope` / `onScopeChange` switch between all students' papers and the admin's own. `currentUserId` marks the
 * admin's own papers.
 * Up to MAX_PAPERS can be ticked; ticking and unticking works on any page. A paper whose text has not been read yet is marked; it is read
 * automatically when the questions are generated.
 * `isDefault` says the selection is still the automatic one; `onReset` brings it back; `moreThanMax` explains the cap.
 */
function PaperPicker({
  selected, onToggle, onRemove, onReset, onClear, isDefault, moreThanMax, error, uploadedBy = '', disabled = false,
  showUploader = false, currentUserId = '', scope = 'all', onScopeChange,
}) {
  const [searchText, setSearchText] = useState('')
  const [search, setSearch] = useState('')
  const [materialType, setMaterialType] = useState('')
  const [page, setPage] = useState(1)

  const { items, meta, loading, refreshing, error: loadError, reload } = useMaterials({
    search, materialType, sort: 'newest', uploadedBy, page, limit: PAGE_SIZE,
  })
  const chosen = Object.values(selected)
  const full = chosen.length >= MAX_PAPERS
  const filtered = Boolean(search || materialType)
  const totalPages = meta?.totalPages ?? 1

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

  let content
  if (loading) {
    content = <MaterialListSkeleton rows={3} />
  } else if (loadError) {
    content = <StatusMessage state="error" title={showUploader ? 'Couldn’t load the papers' : 'Couldn’t load your papers'} text={loadError} onRetry={reload} />
  } else if (items.length === 0) {
    content = filtered ? (
      <StatusMessage state="empty" title="No matching papers" text="Try a different search or clear the filter." />
    ) : (
      <StatusMessage
        state="empty"
        title="No uploaded papers yet"
        text={showUploader ? 'No papers match this view. Questions are generated only from papers you select here.' : 'Upload a question paper or notes in Study materials first. Questions are generated only from papers you select here.'}
      />
    )
  } else {
    content = (
      <div className={refreshing ? 'is-refreshing' : undefined} aria-busy={refreshing}>
        <ul className="paper-options">
          {items.map((paper) => {
            const checked = Boolean(selected[paper._id])
            const note = extractionNote(paper)
            const Icon = isImageMaterial(paper) ? FileImage : FileText
            return (
              <li key={paper._id}>
                <label className={`paper-option ${checked ? 'is-selected' : ''}`} title={!checked && full ? `Maximum of ${MAX_PAPERS} papers reached. Untick one to choose another.` : undefined}>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={disabled || (!checked && full)}
                    onChange={() => onToggle(paper)}
                  />
                  <span className="icon-tile material__icon" aria-hidden="true"><Icon size={18} /></span>
                  <span className="paper-option__body">
                    <span className="paper-option__title">{paper.title}</span>
                    <span className="subject__tags">
                      <span className="tag">{typeLabel(paper.materialType)}</span>
                      <span className="tag tag--muted">{fileKindLabel(paper)}</span>
                      <span className="tag tag--muted">{formatSize(paper.size)}</span>
                      <span className="tag tag--muted">{formatDate(paper.uploadedAt)}</span>
                      {showUploader && (
                        <span className={`tag ${paper.uploadedBy === currentUserId ? 'tag--gold' : 'tag--muted'}`} title={paper.uploader?.email || undefined}>
                          {uploaderLabel(paper, currentUserId)}
                        </span>
                      )}
                      {note && <span className="tag tag--muted">{note}</span>}
                      {checked && <span className="tag tag--selected"><Check size={12} aria-hidden="true" /> Selected</span>}
                    </span>
                  </span>
                </label>
              </li>
            )
          })}
        </ul>
        {totalPages > 1 && (
          <nav className="pager" aria-label="Paper pagination">
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
    <div className={`gen-field ${error ? 'gen-field--error' : ''}`}>
      <div className={`gen-selected ${chosen.length > 0 ? 'has-selection' : ''}`} aria-live="polite">
        <div className="gen-selected__head">
          <p className="gen-selected__count">
            <strong>{chosen.length}</strong> of {MAX_PAPERS} papers selected
            {isDefault && chosen.length > 0 && <span className="muted"> · chosen automatically, change them if you like</span>}
          </p>
          <div className="gen-selected__tools">
            {chosen.length > 0 && (
              <Button size="sm" variant="ghost" onClick={onClear} disabled={disabled}>
                <X size={14} aria-hidden="true" /> Clear selection
              </Button>
            )}
            {!isDefault && (
              <Button size="sm" variant="ghost" onClick={onReset} disabled={disabled}>
                <RotateCcw size={14} aria-hidden="true" /> Use automatic selection
              </Button>
            )}
          </div>
        </div>
        {chosen.length > 0 ? (
          <ul className="gen-chips">
            {chosen.map((paper) => (
              <li key={paper._id} className="gen-chip">
                <Check size={14} aria-hidden="true" />
                <span className="gen-chip__text">{paper.title}</span>
                <button type="button" className="gen-chip__remove" onClick={() => onRemove(paper._id)} disabled={disabled} aria-label={`Remove ${paper.title}`}>
                  <X size={14} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted gen-selected__none">No papers selected. Tick one or more papers below.</p>
        )}
        {full && <p className="field__msg">Maximum of {MAX_PAPERS} papers selected. Untick one to choose a different paper.</p>}
        {isDefault && moreThanMax && (
          <p className="field__msg">At most {MAX_PAPERS} papers can be used per request, so your newest papers were selected.</p>
        )}
      </div>

      <div className="materials-toolbar">
        <div className="materials-toolbar__search">
          <Search size={16} aria-hidden="true" />
          <Input
            type="search"
            aria-label="Search papers"
            placeholder="Search by title or file name"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
            maxLength={100}
          />
        </div>
        <Select
          aria-label="Filter papers by type"
          value={materialType}
          onChange={(e) => { setMaterialType(e.target.value); setPage(1) }}
          options={MATERIAL_TYPES}
          placeholder="All types"
        />
        {showUploader && onScopeChange && (
          <Select
            aria-label="Filter papers by uploader"
            value={scope}
            onChange={(e) => { onScopeChange(e.target.value); setPage(1) }}
            options={[{ value: 'all', label: 'All students’ papers' }, { value: 'mine', label: 'Only my papers' }]}
            placeholder="All uploads"
          />
        )}
      </div>

      {content}

      {error && <p className="field__msg field__msg--error">{error}</p>}
    </div>
  )
}

export default PaperPicker

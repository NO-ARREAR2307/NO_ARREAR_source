import { useCallback, useEffect, useRef, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Alert, Button, Modal } from '../ui'
import { describeError } from '../../services/materialService.js'
import { deleteSavedSet } from '../../services/savedQuestionService.js'

/** Confirmation before DELETE /saved-question-sets/:id (the set is removed for good; a 404 means it is already gone). */
function DeleteSavedSetModal({ set, onClose, onDeleted }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const busyRef = useRef(false)
  useEffect(() => {
    busyRef.current = busy
  }, [busy])
  const handleClose = useCallback(() => {
    if (!busyRef.current) onClose()
  }, [onClose])

  const confirm = async () => {
    setBusy(true)
    setError('')
    try {
      await deleteSavedSet(set._id)
      onDeleted(set)
    } catch (err) {
      if (err?.status === 404) {
        onDeleted(set, { alreadyGone: true })
        return
      }
      setError(describeError(err, 'Could not delete this set.'))
      setBusy(false)
    }
  }

  return (
    <Modal
      isOpen
      onClose={handleClose}
      size="sm"
      title="Delete saved set?"
      footer={
        <>
          <Button variant="ghost" onClick={handleClose} disabled={busy}>Cancel</Button>
          <Button onClick={confirm} loading={busy}>
            {!busy && <Trash2 size={16} aria-hidden="true" />} {busy ? 'Deleting…' : 'Delete'}
          </Button>
        </>
      }
    >
      {error && <Alert>{error}</Alert>}
      <p>
        <strong className="material-delete__name">{set.title}</strong> and its {set.questionCount} {set.questionCount === 1 ? 'question' : 'questions'} will be
        permanently removed. This can’t be undone.
      </p>
      {set.isShared && <p className="muted">This set is shared. Its public link will stop working.</p>}
    </Modal>
  )
}

export default DeleteSavedSetModal

import { useCallback, useEffect, useRef, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Alert, Button, Modal } from '../ui'
import { deleteMaterial, describeError } from '../../services/materialService.js'

/** Confirmation before DELETE /papers/:id (the record and its stored file are removed for good). */
function DeleteMaterialModal({ material, onClose, onDeleted }) {
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
      await deleteMaterial(material._id)
      onDeleted(material)
    } catch (err) {
      setError(describeError(err, 'Could not delete this material.'))
      setBusy(false)
    }
  }

  return (
    <Modal
      isOpen
      onClose={handleClose}
      size="sm"
      title="Delete study material?"
      footer={
        <>
          <Button variant="ghost" onClick={handleClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={confirm} loading={busy}>
            {!busy && <Trash2 size={16} aria-hidden="true" />} {busy ? 'Deleting…' : 'Delete'}
          </Button>
        </>
      }
    >
      {error && <Alert>{error}</Alert>}
      <p>
        <strong className="material-delete__name">{material.title}</strong> and its file will be permanently removed. This
        can’t be undone.
      </p>
    </Modal>
  )
}

export default DeleteMaterialModal

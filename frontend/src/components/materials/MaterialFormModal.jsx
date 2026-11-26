import { useCallback, useEffect, useRef, useState } from 'react'
import { Upload } from 'lucide-react'
import { Alert, Button, Input, Modal, Select, Textarea } from '../ui'
import useForm from '../../hooks/useForm.js'
import { describeError, updateMaterial, uploadMaterial } from '../../services/materialService.js'
import { getFieldErrors } from '../../utils/errors.js'
import {
  DESCRIPTION_MAX_LENGTH, FILE_ACCEPT, FILE_HINT, TITLE_MAX_LENGTH, editRules, formatSize, typeOptions, uploadRules, validateFile,
} from '../../utils/materials.js'

const FORM_ID = 'material-form'

/**
 * One dialog for both flows:
 *  - upload (no `material`): file + optional title, type and description → POST /papers/upload
 *  - edit (`material`): title, type and description → PATCH /papers/:id (the file itself cannot be replaced)
 * Mount it only while it is open, so every opening starts with a fresh form.
 */
function MaterialFormModal({ material, onClose, onSaved }) {
  const isEdit = Boolean(material)
  const form = useForm(
    isEdit
      ? { title: material.title || '', materialType: material.materialType || '', description: material.description || '' }
      : { title: '', materialType: '', description: '', file: null },
    isEdit ? editRules : uploadRules,
  )
  const { values, errors, formError, submitting, handleChange, setFields, setErrors, setFormError } = form
  const [progress, setProgress] = useState(null)

  // The dialog cannot be dismissed while a request is running. The handler stays stable so the dialog keeps focus.
  const busyRef = useRef(false)
  useEffect(() => {
    busyRef.current = submitting
  }, [submitting])
  const handleClose = useCallback(() => {
    if (!busyRef.current) onClose()
  }, [onClose])

  const handleFile = (e) => {
    const file = e.target.files?.[0] ?? null
    setFields({ file })
    if (file) {
      const problem = validateFile(file)
      if (problem) setErrors((prev) => ({ ...prev, file: problem }))
    }
  }

  const submit = form.handleSubmit(async (current) => {
    setProgress(null)
    try {
      const saved = isEdit
        ? await updateMaterial(material._id, {
            title: current.title.trim(),
            description: current.description.trim(), // '' clears the description on the backend
            ...(current.materialType ? { materialType: current.materialType } : {}),
          })
        : await uploadMaterial(
            {
              file: current.file,
              title: current.title,
              description: current.description,
              materialType: current.materialType,
            },
            setProgress,
          )
      onSaved(saved, isEdit ? 'Study material updated.' : 'Study material uploaded.')
    } catch (err) {
      const fieldErrors = getFieldErrors(err)
      setErrors(fieldErrors)
      // Field problems show under their field; anything else (size, type, network, permission) shows at the top.
      if (Object.keys(fieldErrors).length === 0) setFormError(describeError(err))
      setProgress(null)
    }
  })

  const uploading = !isEdit && submitting
  const label = isEdit ? 'Save changes' : 'Upload'

  return (
    <Modal
      isOpen
      onClose={handleClose}
      title={isEdit ? 'Edit study material' : 'Upload study material'}
      footer={
        <>
          <Button variant="ghost" onClick={handleClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" form={FORM_ID} loading={submitting}>
            {!isEdit && !submitting && <Upload size={16} aria-hidden="true" />}
            {submitting ? (isEdit ? 'Saving…' : 'Uploading…') : label}
          </Button>
        </>
      }
    >
      <form id={FORM_ID} className="material-form" onSubmit={submit} noValidate>
        {formError && <Alert>{formError}</Alert>}

        {!isEdit && (
          <Input
            label="File"
            type="file"
            name="file"
            accept={FILE_ACCEPT}
            onChange={handleFile}
            disabled={submitting}
            error={errors.file}
            hint={values.file && !errors.file ? `${values.file.name} · ${formatSize(values.file.size)}` : FILE_HINT}
          />
        )}
        <Input
          label={isEdit ? 'Title' : 'Title (optional)'}
          name="title"
          value={values.title}
          onChange={handleChange}
          maxLength={TITLE_MAX_LENGTH}
          disabled={submitting}
          error={errors.title}
          hint={isEdit ? undefined : 'Leave empty to use the file name'}
          placeholder="e.g. Data Structures – Unit 3 notes"
        />
        <Select
          label="Type"
          name="materialType"
          value={values.materialType}
          onChange={handleChange}
          options={typeOptions(material?.materialType)}
          placeholder={isEdit ? 'Keep current type' : 'Default type'}
          disabled={submitting}
          error={errors.materialType}
        />
        <Textarea
          label="Description (optional)"
          name="description"
          value={values.description}
          onChange={handleChange}
          maxLength={DESCRIPTION_MAX_LENGTH}
          disabled={submitting}
          error={errors.description}
          hint={`${values.description.length}/${DESCRIPTION_MAX_LENGTH}`}
          placeholder="What is in this material?"
        />

        {uploading && progress !== null && (
          <div className="progress" role="progressbar" aria-label="Upload progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
            <span className="progress__bar" style={{ width: `${progress}%` }} />
            <span className="progress__label">{progress < 100 ? `Uploading… ${progress}%` : 'Processing…'}</span>
          </div>
        )}
      </form>
    </Modal>
  )
}

export default MaterialFormModal

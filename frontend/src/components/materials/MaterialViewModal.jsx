import { useEffect, useState } from 'react'
import { Download } from 'lucide-react'
import { Alert, Button, DetailsSkeleton, Modal, StatusMessage } from '../ui'
import { describeError, downloadMaterial, fetchMaterial, fetchMaterialFile } from '../../services/materialService.js'
import { fileKindLabel, formatDate, formatSize, isImageMaterial, typeLabel } from '../../utils/materials.js'

/** Details of one material (fresh from GET /papers/:id), an on-demand file preview and a download button. */
function MaterialViewModal({ material: listed, onClose }) {
  const [detail, setDetail] = useState({ id: null, material: null, error: '' })
  const [tick, setTick] = useState(0)
  const [preview, setPreview] = useState({ state: 'idle', url: '', error: '' }) // idle | loading | ready | error
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState('')

  const loadKey = `${listed._id}:${tick}`
  useEffect(() => {
    let active = true
    fetchMaterial(listed._id)
      .then((material) => active && setDetail({ id: loadKey, material, error: '' }))
      .catch((err) => active && setDetail({ id: loadKey, material: null, error: describeError(err, 'Could not load this material.') }))
    return () => {
      active = false
    }
  }, [listed._id, loadKey])

  // Release the preview's object URL when it is replaced or the dialog closes.
  useEffect(() => () => preview.url && URL.revokeObjectURL(preview.url), [preview.url])

  const ready = detail.id === loadKey
  const material = ready && detail.material ? detail.material : null
  const shown = material || listed // the list row is good enough to show the actions while the details load

  const showPreview = async () => {
    setPreview({ state: 'loading', url: '', error: '' })
    try {
      const blob = await fetchMaterialFile(shown._id)
      setPreview({ state: 'ready', url: URL.createObjectURL(blob), error: '' })
    } catch (err) {
      setPreview({ state: 'error', url: '', error: describeError(err, 'Could not open the file.') })
    }
  }

  const handleDownload = async () => {
    setDownloading(true)
    setDownloadError('')
    try {
      await downloadMaterial(shown)
    } catch (err) {
      setDownloadError(describeError(err, 'Could not download the file.'))
    } finally {
      setDownloading(false)
    }
  }

  const rows = material && [
    ['Type', typeLabel(material.materialType)],
    ['File', `${material.originalName} · ${fileKindLabel(material)} · ${formatSize(material.size)}`],
    ['Uploaded', formatDate(material.uploadedAt)],
    ...(material.updatedAt ? [['Last edited', formatDate(material.updatedAt)]] : []),
  ]

  return (
    <Modal
      isOpen
      onClose={onClose}
      size="lg"
      title={shown.title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button onClick={handleDownload} loading={downloading}>
            {!downloading && <Download size={16} aria-hidden="true" />} Download
          </Button>
        </>
      }
    >
      <div className="material-view">
        {downloadError && <Alert>{downloadError}</Alert>}

        {!ready ? (
          <DetailsSkeleton rows={4} />
        ) : detail.error ? (
          <StatusMessage state="error" title="Couldn’t load this material" text={detail.error} onRetry={() => setTick((t) => t + 1)} />
        ) : (
          <>
            {material.description && <p className="material-view__desc">{material.description}</p>}
            <dl className="details details--row">
              {rows.map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>

            <div className="material-preview">
              {preview.state === 'idle' && (
                <Button variant="outline" size="sm" onClick={showPreview}>
                  Preview file
                </Button>
              )}
              {preview.state === 'loading' && <StatusMessage state="loading" title="Loading preview…" />}
              {preview.state === 'error' && (
                <StatusMessage state="error" title="Couldn’t open the file" text={preview.error} onRetry={showPreview} />
              )}
              {preview.state === 'ready' &&
                (isImageMaterial(material) ? (
                  <img className="material-preview__image" src={preview.url} alt={material.title} />
                ) : (
                  <iframe className="material-preview__frame" src={preview.url} title={`Preview of ${material.title}`} />
                ))}
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}

export default MaterialViewModal

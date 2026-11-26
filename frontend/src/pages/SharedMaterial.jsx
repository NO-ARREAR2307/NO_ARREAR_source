import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Download, Eye } from 'lucide-react'
import logo from '../assets/logo.svg'
import { Alert, Button, Card, DetailsSkeleton, StatusMessage } from '../components/ui'
import { describeError } from '../services/materialService.js'
import { downloadSharedFile, fetchSharedFile, fetchSharedMaterial } from '../services/sharingService.js'
import { fileKindLabel, formatDate, formatSize, isImageMaterial, typeLabel } from '../utils/materials.js'

/** Public page behind a share link (/shared/materials/:token). No login: the token in the URL is the access. */
function SharedMaterial() {
  const { token } = useParams()
  const [tick, setTick] = useState(0)
  const [result, setResult] = useState({ key: null, material: null, error: '', status: null })
  const [preview, setPreview] = useState({ state: 'idle', url: '', error: '' }) // idle | loading | ready | error
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState('')

  // The link is a secret and must not be indexed or sent on in the Referer header.
  useEffect(() => {
    const robots = document.createElement('meta')
    robots.name = 'robots'
    robots.content = 'noindex, nofollow'
    const referrer = document.createElement('meta')
    referrer.name = 'referrer'
    referrer.content = 'no-referrer'
    document.head.append(robots, referrer)
    return () => {
      robots.remove()
      referrer.remove()
    }
  }, [])

  const key = `${token}:${tick}`
  useEffect(() => {
    let active = true
    fetchSharedMaterial(token)
      .then((material) => active && setResult({ key, material, error: '', status: null }))
      .catch((err) => active && setResult({ key, material: null, error: describeError(err, 'Could not open this shared material.'), status: err?.status ?? null }))
    return () => {
      active = false
    }
  }, [token, key])

  useEffect(() => () => preview.url && URL.revokeObjectURL(preview.url), [preview.url])

  const loaded = result.key === key
  const material = loaded ? result.material : null
  useEffect(() => {
    if (material?.title) document.title = `${material.title} · NO_ARREAR`
    return () => {
      document.title = 'NO_ARREAR'
    }
  }, [material?.title])

  const showPreview = async () => {
    setPreview({ state: 'loading', url: '', error: '' })
    try {
      const blob = await fetchSharedFile(token)
      setPreview({ state: 'ready', url: URL.createObjectURL(blob), error: '' })
    } catch (err) {
      setPreview({ state: 'error', url: '', error: describeError(err, 'Could not open the file.') })
    }
  }

  const handleDownload = async () => {
    setDownloading(true)
    setDownloadError('')
    try {
      await downloadSharedFile(token, material)
    } catch (err) {
      setDownloadError(describeError(err, 'Could not download the file.'))
    } finally {
      setDownloading(false)
    }
  }

  const unavailable = loaded && result.error && (result.status === 404 || result.status === 400)

  let content
  if (!loaded) {
    content = <DetailsSkeleton rows={4} />
  } else if (unavailable) {
    content = (
      <StatusMessage
        state="empty"
        title="This link isn’t available"
        text="The link may have been revoked, or the address is incorrect. Ask the person who shared it for a new link."
      />
    )
  } else if (result.error) {
    content = <StatusMessage state="error" title="Couldn’t open this material" text={result.error} onRetry={() => setTick((t) => t + 1)} />
  } else {
    const rows = [
      ['Type', typeLabel(material.materialType)],
      ['File', `${material.fileName} · ${fileKindLabel(material)} · ${formatSize(material.size)}`],
      ...(material.pageCount ? [['Pages', String(material.pageCount)]] : []),
      ['Uploaded', formatDate(material.uploadedAt)],
      ...(material.sharedAt ? [['Shared', formatDate(material.sharedAt)]] : []),
    ]
    content = (
      <Card
        title={material.title}
        subtitle="Shared study material"
        actions={
          <>
            <Button variant="outline" onClick={preview.state === 'idle' || preview.state === 'error' ? showPreview : undefined} disabled={preview.state === 'loading' || preview.state === 'ready'}>
              <Eye size={16} aria-hidden="true" /> View
            </Button>
            <Button onClick={handleDownload} loading={downloading}>
              {!downloading && <Download size={16} aria-hidden="true" />} Download
            </Button>
          </>
        }
      >
        <div className="material-view">
          {downloadError && <Alert>{downloadError}</Alert>}
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
            {preview.state === 'loading' && <StatusMessage state="loading" title="Loading file…" />}
            {preview.state === 'error' && <StatusMessage state="error" title="Couldn’t open the file" text={preview.error} onRetry={showPreview} />}
            {preview.state === 'ready' &&
              (isImageMaterial(material) ? (
                <img className="material-preview__image" src={preview.url} alt={material.title} />
              ) : (
                <iframe className="material-preview__frame" src={preview.url} title={`Preview of ${material.title}`} />
              ))}
          </div>
        </div>
      </Card>
    )
  }

  return (
    <div className="shared">
      <header className="shared__bar">
        <Link to="/" className="brand">
          <img src={logo} alt="" className="brand__logo" />
          <span className="brand__name">NO_ARREAR</span>
        </Link>
      </header>
      <main className="shared__main">{content}</main>
    </div>
  )
}

export default SharedMaterial

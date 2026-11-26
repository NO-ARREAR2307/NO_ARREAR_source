import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Copy, ExternalLink, Link2, MessageCircle, RefreshCw, Share2, ShieldOff } from 'lucide-react'
import { Alert, Button, DetailsSkeleton, Input, Modal, StatusMessage } from '../ui'
import { describeError } from '../../services/materialService.js'
import { enableShare, fetchShareStatus, revokeShare } from '../../services/sharingService.js'
import { formatDate } from '../../utils/materials.js'
import { buildPublicShareUrl, buildWhatsAppUrl, copyToClipboard, extractShareToken } from '../../utils/sharing.js'

const NO_ACCESS = 'You don’t have permission to share this material, or it no longer exists.'

const explain = (err, fallback) => (err?.status === 404 ? NO_ACCESS : describeError(err, fallback))

/**
 * Sharing dialog for one material (owner or admin; the backend refuses everyone else with a 404).
 *  - private → "Create share link"
 *  - shared  → copy / WhatsApp / device share, plus "New link" and "Revoke link"
 * The backend shows the link only when it is created, never again. `knownLink` is the link created earlier in this
 * session (kept in memory by the page, never stored); after a reload only "New link" or "Revoke" are possible.
 * `onLinkChange(id, link)` remembers/forgets that link; `onChanged(text)` tells the page to refresh its list.
 */
function ShareMaterialModal({ material, knownLink = '', onLinkChange, onChanged, onClose }) {
  const [tick, setTick] = useState(0)
  const [status, setStatus] = useState({ id: null, isShared: false, sharedAt: null, error: '' })
  const [link, setLink] = useState(knownLink)
  const [busy, setBusy] = useState('') // '' | 'create' | 'replace' | 'revoke'
  const [confirm, setConfirm] = useState('') // '' | 'replace' | 'revoke'
  const [feedback, setFeedback] = useState(null) // { variant, text }
  const [copied, setCopied] = useState(false)

  const loadKey = `${material._id}:${tick}`
  useEffect(() => {
    let active = true
    fetchShareStatus(material._id)
      .then((data) => active && setStatus({ id: loadKey, isShared: data?.isShared === true, sharedAt: data?.sharedAt ?? null, error: '' }))
      .catch((err) => active && setStatus({ id: loadKey, isShared: false, sharedAt: null, error: explain(err, 'Could not load the sharing status.') }))
    return () => {
      active = false
    }
  }, [material._id, loadKey])

  const busyRef = useRef(false)
  useEffect(() => {
    busyRef.current = Boolean(busy)
  }, [busy])
  const handleClose = useCallback(() => {
    if (!busyRef.current) onClose()
  }, [onClose])

  useEffect(() => {
    if (!copied) return undefined
    const timer = setTimeout(() => setCopied(false), 2500)
    return () => clearTimeout(timer)
  }, [copied])

  const loaded = status.id === loadKey
  const isShared = loaded && !status.error && status.isShared
  const activeLink = isShared ? link : ''
  const canDeviceShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'

  const create = async (kind) => {
    if (busyRef.current) return // one request per click, even if the button is hit twice before it re-renders
    busyRef.current = true
    setBusy(kind)
    setConfirm('')
    setFeedback(null)
    try {
      const res = await enableShare(material._id, { replace: kind === 'replace' })
      const token = extractShareToken(res.data?.shareUrl)
      const url = token ? buildPublicShareUrl(token) : res.data?.shareUrl || ''
      setLink(url)
      onLinkChange?.(material._id, url)
      setStatus((s) => ({ ...s, isShared: true, sharedAt: res.data?.sharedAt ?? new Date().toISOString(), error: '' }))
      const text = kind === 'replace' ? 'New link created. The previous link no longer works.' : 'Share link created. Anyone with the link can view and download this material.'
      setFeedback({ variant: 'success', text })
      onChanged?.(text)
    } catch (err) {
      if (err?.status === 409) {
        // Someone (another tab, a retry) already created a link: the status is "shared", but its link cannot be shown again.
        setStatus((s) => ({ ...s, isShared: true }))
        setFeedback({ variant: 'error', text: 'This material already has an active link, which can’t be shown again. Create a new link (the old one stops working) or revoke it.' })
      } else {
        setFeedback({ variant: 'error', text: explain(err, 'Could not create the share link.') })
      }
    } finally {
      setBusy('')
    }
  }

  const revoke = async () => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy('revoke')
    setConfirm('')
    setFeedback(null)
    try {
      await revokeShare(material._id)
      setLink('')
      onLinkChange?.(material._id, '')
      setStatus((s) => ({ ...s, isShared: false, sharedAt: null }))
      const text = 'Share link revoked. The link no longer works.'
      setFeedback({ variant: 'success', text })
      onChanged?.(text)
    } catch (err) {
      setFeedback({ variant: 'error', text: explain(err, 'Could not revoke the share link.') })
    } finally {
      setBusy('')
    }
  }

  const copy = async () => {
    try {
      await copyToClipboard(activeLink)
      setCopied(true)
      setFeedback({ variant: 'success', text: 'Link copied. Paste it in Instagram (bio, story or message) or any other app.' })
    } catch {
      setFeedback({ variant: 'error', text: 'Could not copy automatically. Select the link above and copy it manually.' })
    }
  }

  const openWhatsApp = () => window.open(buildWhatsAppUrl(material.title, activeLink), '_blank', 'noopener,noreferrer')

  const deviceShare = async () => {
    try {
      await navigator.share({ title: material.title, text: `${material.title} — study material on NO_ARREAR`, url: activeLink })
    } catch (err) {
      if (err?.name !== 'AbortError') setFeedback({ variant: 'error', text: 'Could not open the share sheet. Use Copy link instead.' })
    }
  }

  let body
  if (!loaded) {
    body = <DetailsSkeleton rows={2} />
  } else if (status.error) {
    body = <StatusMessage state="error" title="Couldn’t load sharing status" text={status.error} onRetry={() => setTick((t) => t + 1)} />
  } else if (!isShared) {
    body = (
      <div className="share">
        <p className="share__lead">
          <span className="tag tag--muted">Private</span> Only you and admins can see this material right now.
        </p>
        <p className="muted">
          Create a secure link to share it. Anyone who has the link can view and download the file without logging in. You can revoke the link at any time.
        </p>
        <Button onClick={() => create('create')} loading={busy === 'create'} disabled={Boolean(busy)}>
          {busy !== 'create' && <Link2 size={16} aria-hidden="true" />} {busy === 'create' ? 'Creating…' : 'Create share link'}
        </Button>
      </div>
    )
  } else {
    body = (
      <div className="share">
        <p className="share__lead">
          <span className="tag tag--gold">Shared</span>
          <span className="muted">Link active{status.sharedAt ? ` since ${formatDate(status.sharedAt)}` : ''}. Anyone with the link can view and download this material.</span>
        </p>

        {activeLink ? (
          <>
            <div className="share__link">
              <Input
                aria-label="Share link"
                readOnly
                value={activeLink}
                onFocus={(e) => e.target.select()}
                hint="Shown only until you leave or refresh this page. Keep it private: anyone with it can open the file."
              />
              <Button variant="outline" onClick={copy} disabled={Boolean(busy)}>
                {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />} {copied ? 'Copied' : 'Copy link'}
              </Button>
            </div>
            <div className="share__channels" role="group" aria-label="Share via">
              <Button className="btn--whatsapp" onClick={openWhatsApp} disabled={Boolean(busy)}>
                <MessageCircle size={16} aria-hidden="true" /> WhatsApp
              </Button>
              <Button variant="outline" onClick={copy} disabled={Boolean(busy)}>
                <Copy size={16} aria-hidden="true" /> Copy for Instagram
              </Button>
              {canDeviceShare && (
                <Button variant="outline" onClick={deviceShare} disabled={Boolean(busy)}>
                  <Share2 size={16} aria-hidden="true" /> More…
                </Button>
              )}
              <a className="btn btn--ghost btn--md" href={activeLink} target="_blank" rel="noopener noreferrer">
                <ExternalLink size={16} aria-hidden="true" /> Open
              </a>
            </div>
            <p className="muted share__note">Instagram has no web share option: copy the link and paste it into your bio, story or a message.</p>
          </>
        ) : (
          <Alert variant="info">
            For security, a link is shown only when it is created, so it can’t be shown again. To share this material again, create a new link (the old one
            stops working), or revoke sharing.
          </Alert>
        )}

        <div className="share__manage">
          {confirm === 'replace' ? (
            <>
              <span className="muted">The current link will stop working. Continue?</span>
              <Button size="sm" onClick={() => create('replace')} loading={busy === 'replace'}>Yes, create new link</Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirm('')} disabled={Boolean(busy)}>Cancel</Button>
            </>
          ) : confirm === 'revoke' ? (
            <>
              <span className="muted">Anyone using the link will lose access. Continue?</span>
              <Button size="sm" className="btn--danger-solid" onClick={revoke} loading={busy === 'revoke'}>Yes, revoke link</Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirm('')} disabled={Boolean(busy)}>Cancel</Button>
            </>
          ) : (
            <>
              <Button size="sm" variant="outline" onClick={() => setConfirm('replace')} disabled={Boolean(busy)}>
                <RefreshCw size={15} aria-hidden="true" /> New link
              </Button>
              <Button size="sm" variant="ghost" className="btn--danger" onClick={() => setConfirm('revoke')} disabled={Boolean(busy)}>
                <ShieldOff size={15} aria-hidden="true" /> Revoke link
              </Button>
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <Modal
      isOpen
      onClose={handleClose}
      size="md"
      title={`Share “${material.title}”`}
      footer={<Button variant="ghost" onClick={handleClose} disabled={Boolean(busy)}>Close</Button>}
    >
      {feedback && <div className="share__feedback"><Alert variant={feedback.variant}>{feedback.text}</Alert></div>}
      {body}
    </Modal>
  )
}

export default ShareMaterialModal

// Helpers for sharing study materials (Phase 4.3B). Pure functions, so they can be unit-tested without a browser.

export const SHARE_PATH_PREFIX = '/shared/materials/'

/** The token is the last path segment of the share URL the backend returns ("…/shared/materials/<token>"). */
export function extractShareToken(shareUrl) {
  const text = String(shareUrl ?? '').split(/[?#]/)[0].replace(/\/+$/, '')
  const index = text.lastIndexOf(SHARE_PATH_PREFIX)
  if (index === -1) return ''
  return text.slice(index + SHARE_PATH_PREFIX.length).split('/')[0]
}

/** The public page lives in THIS frontend, so the link always points at the origin the app is running on. */
export function buildPublicShareUrl(token, origin = globalThis.location?.origin ?? '') {
  return token ? `${String(origin).replace(/\/+$/, '')}${SHARE_PATH_PREFIX}${encodeURIComponent(token)}` : ''
}

/** WhatsApp "click to chat" link that opens WhatsApp (app or web) with the message ready to send. */
export function buildWhatsAppUrl(title, url) {
  const text = `${title ? `${title}\n` : ''}Study material on NO_ARREAR:\n${url}`
  return `https://wa.me/?text=${encodeURIComponent(text)}`
}

/** Copies text; falls back to a hidden textarea where the async clipboard API is unavailable (plain http, old browsers). */
export async function copyToClipboard(text) {
  if (globalThis.navigator?.clipboard?.writeText && globalThis.isSecureContext) {
    await navigator.clipboard.writeText(text)
    return
  }
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.style.cssText = 'position:fixed;top:0;left:0;opacity:0'
  document.body.appendChild(area)
  area.select()
  const ok = document.execCommand?.('copy')
  area.remove()
  if (!ok) throw new Error('Copy is not supported in this browser')
}

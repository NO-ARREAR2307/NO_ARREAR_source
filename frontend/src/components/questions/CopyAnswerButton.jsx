import { useEffect, useRef, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { Button } from '../ui'
import { copyToClipboard } from '../../utils/sharing.js'

/** Small Copy button for one AI-generated answer. Copies only `text` and shows a short message beside the button. */
function CopyAnswerButton({ text, label = 'Copy answer' }) {
  const [state, setState] = useState(null) // 'ok' | 'error' | null
  const timer = useRef(null)
  useEffect(() => () => clearTimeout(timer.current), [])
  if (!String(text ?? '').trim()) return null

  const copy = async () => {
    clearTimeout(timer.current)
    try {
      await copyToClipboard(text)
      setState('ok')
    } catch {
      setState('error')
    }
    timer.current = setTimeout(() => setState(null), 2500)
  }

  return (
    <span className="gen-answer__copy">
      <Button size="sm" variant="ghost" onClick={copy} aria-label={label}>
        {state === 'ok' ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />} <span>{state === 'ok' ? 'Copied' : 'Copy'}</span>
      </Button>
      <span className={`gen-copy-status ${state === 'error' ? 'is-error' : ''}`} role="status" aria-live="polite">
        {state === 'ok' ? 'Answer copied successfully' : state === 'error' ? 'Could not copy. Please select the text and copy it manually.' : ''}
      </span>
    </span>
  )
}

export default CopyAnswerButton

import { useEffect, useState } from 'react'

/**
 * Loads dropdown options with loading / error / empty handling.
 * `loader(key)` returns a promise of [{ value, label }]. With a falsy `key` nothing is loaded (parent not chosen yet).
 */
export default function useOptions(loader, key) {
  const [tick, setTick] = useState(0)
  const [result, setResult] = useState({ id: null, options: [], error: '' })
  const id = key ? `${key}:${tick}` : null

  useEffect(() => {
    if (!id) return undefined
    let active = true
    loader(key)
      .then((options) => active && setResult({ id, options, error: '' }))
      .catch((err) => active && setResult({ id, options: [], error: err?.message || 'Could not load options.' }))
    return () => {
      active = false
    }
  }, [id, key, loader])

  const ready = Boolean(id) && result.id === id
  return {
    options: ready ? result.options : [],
    loading: Boolean(id) && !ready,
    error: ready ? result.error : '',
    reload: () => setTick((t) => t + 1),
  }
}

import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchSavedSet } from '../services/savedQuestionService.js'
import { inferSource, loadSourceCache, readBackendSource, rememberSource } from '../utils/savedQuestions.js'

const CONCURRENCY = 2

/**
 * The origin (manual / from papers / mixed) of the listed sets. The list endpoint returns no questions, so a row whose origin is
 * not known yet (not saved from this browser, nothing cached) is opened quietly, two at a time, and the result is remembered for
 * next time. Returns { sources: { [id]: source }, pending: ids still being worked out, remember(id, source), forget(id) }.
 * A set that cannot be opened simply stays without a label.
 */
export default function useSetSources(items, userId) {
  const [sources, setSources] = useState(() => loadSourceCache(userId))
  const [pending, setPending] = useState([])
  const known = useRef(sources)
  const attempted = useRef(new Set())

  const remember = useCallback((id, source) => {
    rememberSource(userId, id, source)
    known.current = { ...known.current, [id]: source }
    setSources(known.current)
  }, [userId])

  const forget = useCallback((id) => {
    rememberSource(userId, id, null)
    known.current = Object.fromEntries(Object.entries(known.current).filter(([key]) => key !== id))
    setSources(known.current)
  }, [userId])

  useEffect(() => {
    const todo = items.filter((set) => set?._id && !readBackendSource(set) && !known.current[set._id] && !attempted.current.has(set._id))
    if (todo.length === 0) return undefined
    let active = true
    todo.forEach((set) => attempted.current.add(set._id))
    const ids = todo.map((set) => set._id)
    Promise.resolve().then(() => active && setPending((current) => [...new Set([...current, ...ids])]))

    const queue = [...todo]
    const finish = (id) => active && setPending((current) => current.filter((item) => item !== id))
    const worker = async () => {
      while (active && queue.length > 0) {
        const set = queue.shift()
        try {
          const full = await fetchSavedSet(set._id)
          const source = inferSource(full?.questions)
          if (active && source) remember(set._id, source)
        } catch { /* leave this row without a label */ }
        finish(set._id)
      }
    }
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker)
    return () => {
      active = false
      ids.forEach((id) => attempted.current.delete(id)) // an abandoned lookup is tried again when the rows come back
      setPending((current) => current.filter((id) => !ids.includes(id)))
    }
  }, [items, remember])

  return { sources, pending, remember, forget }
}

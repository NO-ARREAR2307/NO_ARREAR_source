import { useCallback, useEffect, useState } from 'react'
import { describeError } from '../services/materialService.js'
import { fetchSavedSets } from '../services/savedQuestionService.js'

/**
 * Loads one page of saved question sets with loading / error / refreshing states: the signed-in student's own (GET /api/saved-question-sets) or,
 * with `admin`, those of all students (GET /api/admin/saved-question-sets, optionally narrowed to one student with `studentId`).
 *  - `loading`    first load, nothing to show yet
 *  - `refreshing` search / sort / page changed (or reload): the previous rows stay visible, dimmed
 *  - `error`      message when the latest request failed (rows are cleared)
 * Call `reload()` after a delete or a save.
 */
export default function useSavedSets({ q, sort, page, limit, admin = false, studentId = '' }) {
  const [tick, setTick] = useState(0)
  const [result, setResult] = useState({ key: null, items: [], meta: null, error: '' })
  const reload = useCallback(() => setTick((t) => t + 1), [])
  const key = [q, sort, page, limit, admin, studentId, tick].join('|')

  useEffect(() => {
    let active = true
    const params = { page, limit, sort }
    if (q) params.q = q
    if (admin && studentId) params.studentId = studentId

    fetchSavedSets(params, { admin })
      .then(({ items, meta }) => active && setResult({ key, items, meta, error: '' }))
      .catch((err) => active && setResult({ key, items: [], meta: null, error: describeError(err, 'Could not load your saved questions.') }))
    return () => {
      active = false
    }
  }, [key, q, sort, page, limit, admin, studentId])

  const ready = result.key === key
  return {
    items: result.error && ready ? [] : result.items,
    meta: result.meta,
    loading: result.key === null,
    refreshing: result.key !== null && !ready,
    error: ready ? result.error : '',
    reload,
  }
}

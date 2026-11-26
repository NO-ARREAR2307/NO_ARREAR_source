import { useCallback, useEffect, useState } from 'react'
import { describeError, fetchMaterials } from '../services/materialService.js'

/**
 * Loads one page of study materials (GET /api/papers) with loading / error / refreshing states.
 *  - `loading`    first load, nothing to show yet
 *  - `refreshing` filters/page changed (or reload): the previous rows stay visible, dimmed
 *  - `error`      message when the latest request failed (rows are cleared)
 * Call `reload()` after an upload, edit or delete.
 */
export default function useMaterials({ search, materialType, sort, uploadedBy, page, limit }) {
  const [tick, setTick] = useState(0)
  const [result, setResult] = useState({ key: null, items: [], meta: null, error: '' })
  const reload = useCallback(() => setTick((t) => t + 1), [])
  const key = [search, materialType, sort, uploadedBy, page, limit, tick].join('|')

  useEffect(() => {
    let active = true
    const params = { page, limit, sort }
    if (search) params.search = search
    if (materialType) params.materialType = materialType
    if (uploadedBy) params.uploadedBy = uploadedBy

    fetchMaterials(params)
      .then(({ items, meta }) => active && setResult({ key, items, meta, error: '' }))
      .catch((err) => active && setResult({ key, items: [], meta: null, error: describeError(err, 'Could not load study materials.') }))
    return () => {
      active = false
    }
  }, [key, search, materialType, sort, uploadedBy, page, limit])

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

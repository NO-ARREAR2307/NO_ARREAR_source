import { useEffect, useState } from 'react'
import { fetchAdminStats } from '../services/adminService.js'

/** Loads the admin overview totals (GET /admin/stats) with loading / error / retry handling. Nothing loads while `enabled` is false. */
export default function useAdminOverview(enabled) {
  const [tick, setTick] = useState(0)
  const [result, setResult] = useState({ id: null, data: null, error: '' })
  const id = enabled ? tick : null

  useEffect(() => {
    if (id === null) return undefined
    let active = true
    fetchAdminStats()
      .then((data) => active && setResult({ id, data, error: '' }))
      .catch((err) => active && setResult({ id, data: null, error: err?.message || 'Could not load the overview.' }))
    return () => {
      active = false
    }
  }, [id])

  const ready = id !== null && result.id === id
  return {
    loading: id !== null && !ready,
    data: ready ? result.data : null,
    error: ready ? result.error : '',
    reload: () => setTick((t) => t + 1),
  }
}

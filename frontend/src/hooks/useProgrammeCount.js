import { useEffect, useState } from 'react'
import { fetchProgrammeCount } from '../services/adminService.js'

/** Loads the distinct programme count for the Total Courses card. `value` is null when it cannot be determined (N/A). */
export default function useProgrammeCount(enabled) {
  const [result, setResult] = useState({ done: false, value: null, failed: false })

  useEffect(() => {
    if (!enabled) return undefined
    let active = true
    fetchProgrammeCount()
      .then(({ totalProgrammes }) => active && setResult({ done: true, value: totalProgrammes, failed: false }))
      .catch(() => active && setResult({ done: true, value: null, failed: true }))
    return () => {
      active = false
    }
  }, [enabled])

  return { loading: !result.done, value: result.value, failed: result.failed }
}

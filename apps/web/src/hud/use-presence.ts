import { useEffect, useState } from "react"

/**
 * Keep the last non-null value mounted for `ms` after it becomes null, so the
 * element can play an exit animation. `exiting` is true during that window.
 */
export const usePresence = <T>(value: T | null, ms = 160) => {
  const [last, setLast] = useState<T | null>(value)
  // Adopt new values during render (React's "derive state from props" pattern).
  if (value !== null && value !== last) setLast(value)
  useEffect(() => {
    if (value !== null) return
    const id = setTimeout(() => setLast(null), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return { value: value ?? last, exiting: value === null && last !== null }
}

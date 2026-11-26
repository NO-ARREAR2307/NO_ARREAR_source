import { useCallback, useEffect, useMemo, useState } from 'react'
import { answersFor, sanitizeManualQuestions, sanitizeStoredAnswers, toManualQuestion } from '../utils/manualQuestions.js'

const keyFor = (userId) => `noarrear:manual-questions:${userId || 'guest'}`
const answersKeyFor = (userId) => `noarrear:manual-answers:${userId || 'guest'}`

const load = (key) => {
  try {
    return sanitizeManualQuestions(JSON.parse(sessionStorage.getItem(key)))
  } catch {
    return [] // nothing saved, or storage unavailable
  }
}

const loadAnswers = (key) => {
  try {
    return sanitizeStoredAnswers(JSON.parse(sessionStorage.getItem(key)))
  } catch {
    return {}
  }
}

const newId = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)

/**
 * The questions the student typed in, and the AI answers generated for them. Kept in this tab's session storage (per user)
 * so a refresh does not lose them; the server stores neither. Callers pass drafts that already passed validateManualQuestion.
 * `answers` is { [questionId]: answerPoints[] } and only holds answers that still match their question's text, type and marks.
 */
export default function useManualQuestions(userId) {
  const key = keyFor(userId)
  const answersKey = answersKeyFor(userId)
  const [questions, setQuestions] = useState(() => load(key))
  const [stored, setStored] = useState(() => loadAnswers(answersKey))

  useEffect(() => {
    try {
      sessionStorage.setItem(key, JSON.stringify(questions))
    } catch { /* storage unavailable: the list still works for this visit */ }
  }, [key, questions])

  useEffect(() => {
    try {
      sessionStorage.setItem(answersKey, JSON.stringify(stored))
    } catch { /* storage unavailable: the answers still work for this visit */ }
  }, [answersKey, stored])

  const add = useCallback((draft) => setQuestions((list) => [...list, { id: newId(), ...toManualQuestion(draft) }]), [])
  const update = useCallback((id, draft) => setQuestions((list) => list.map((q) => (q.id === id ? { id, ...toManualQuestion(draft) } : q))), [])
  const remove = useCallback((id) => {
    setQuestions((list) => list.filter((q) => q.id !== id))
    setStored((current) => Object.fromEntries(Object.entries(current).filter(([answerId]) => answerId !== id)))
  }, [])
  const clear = useCallback(() => {
    setQuestions([])
    setStored({})
  }, [])

  // `items` are the questions the server answered: [{ id, question, questionType, marks, answerPoints }].
  const saveAnswers = useCallback((items) => {
    setStored((current) => {
      const next = { ...current }
      items.forEach(({ id, question, questionType, marks, answerPoints }) => { next[id] = { question, questionType, marks, answerPoints } })
      return next
    })
  }, [])

  const answers = useMemo(() => answersFor(questions, stored), [questions, stored])

  return { questions, answers, add, update, remove, clear, saveAnswers }
}

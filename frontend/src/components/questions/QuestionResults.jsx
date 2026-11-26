import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Check, Copy, Info, Pencil, Search, Sparkles, Trash2 } from 'lucide-react'
import { Alert, Button, Card, Input, StatusMessage } from '../ui'
import { countQuestions, describeUnmet, filterGroups, formatAnswerForCopy, formatQuestionForCopy, formatQuestionsForCopy, groupByType, typeLabel } from '../../utils/questionGeneration.js'
import { copyToClipboard } from '../../utils/sharing.js'
import { humanize } from '../../utils/academic.js'
import CopyAnswerButton from './CopyAnswerButton.jsx'

const FALLBACK_DISCLAIMER =
  'AI-generated practice questions based only on the papers you uploaded. They are not taken from the official syllabus or from previous question papers, and there is no guarantee that any of them will appear in an examination.'

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

const MANUAL_ANSWER_NOTE =
  'Answers for your own questions are AI-generated study aids. They are not taken from the official syllabus or from previous question papers and are not based on your uploaded papers. Check every answer against your textbooks and notes.'

/**
 * Questions grouped by type and then by marks, with search. Generated questions (no answers in this phase) also get warnings
 * and the backend disclaimer. With `manual`, the student's own questions are listed instead: no generation summary, an
 * Edit / Delete buttons (`onEdit(question)`, `onDelete(question)`; `busyId` marks the one being edited) and, for answers,
 * `answers` ({ [questionId]: answerPoints[] }), `onAnswer(question)` and `answeringIds` (ids waiting for an AI answer).
 * `saveAction` is an optional element (the Save question set button) shown next to Copy All.
 */
function QuestionResults({ result, papers = [], manual = false, onEdit, onDelete, busyId = null, answers = {}, onAnswer, answeringIds = [], answerDisabled = false, saveAction = null }) {
  const [query, setQuery] = useState('')
  const [copied, setCopied] = useState(null) // { key: 'all' | questionId, text } after a successful copy, { key, error: true } after a failed one
  const copyTimer = useRef(null)
  useEffect(() => () => clearTimeout(copyTimer.current), [])
  const searching = query.trim() !== ''
  const visibleGroups = filterGroups(result.groups, query)
  const visibleCount = countQuestions(visibleGroups)
  const sections = groupByType(visibleGroups)
  const subject = result.subject
  const semester = result.academic?.semester?.semesterNumber

  // Copies plain text and shows a short message for a couple of seconds.
  const copy = async (key, text, message) => {
    clearTimeout(copyTimer.current)
    try {
      await copyToClipboard(text)
      setCopied({ key, text: message })
    } catch {
      setCopied({ key, text: 'Could not copy. Please select the text and copy it manually.', error: true })
    }
    copyTimer.current = setTimeout(() => setCopied(null), 2500)
  }
  const copyAll = () => copy('all', formatQuestionsForCopy(result.groups), `Copied all ${plural(countQuestions(result.groups), 'question')}.`)
  const copyOne = (q, questionType, marks) => copy(q.questionId, formatQuestionForCopy(q, { questionType, marks }), 'Question copied.')

  return (
    <Card
      title={manual ? 'Your questions' : 'Generated questions'}
      subtitle={manual ? 'Entered by you' : [subject?.name, semester ? `Semester ${semester}` : '', result.difficulty ? `${humanize(result.difficulty)} difficulty` : ''].filter(Boolean).join(' · ') || undefined}
    >
      <div className="gen-results">
        {!manual && (
        <p className="gen-results__summary">
          <strong>{result.generated}</strong> of {result.requested} requested {result.requested === 1 ? 'question' : 'questions'} generated
          {papers.length > 0 && <span className="muted"> · from {papers.map((p) => p.title).join(', ')}</span>}
        </p>
        )}

        {result.partial && (
          <div className="gen-warning" role="status">
            <p className="gen-warning__title"><AlertTriangle size={16} aria-hidden="true" /> Only part of your request could be generated</p>
            {result.shortfall > 0 && <p>{plural(result.shortfall, 'question')} short of what you asked for. Try generating again to fill the gap.</p>}
            {result.unmet?.length > 0 && (
              <ul>
                {result.unmet.map((u) => (
                  <li key={`${u.marks}-${u.questionType ?? 'any'}`}>{describeUnmet(u)}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {result.warnings?.length > 0 && (
          <div className="gen-warning" role="status">
            <p className="gen-warning__title"><AlertTriangle size={16} aria-hidden="true" /> Notes from the generator</p>
            <ul>{result.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
          </div>
        )}

        {result.extractionWarnings?.length > 0 && (
          <div className="gen-warning" role="status">
            <p className="gen-warning__title"><AlertTriangle size={16} aria-hidden="true" /> About the text read from your papers</p>
            <ul>{result.extractionWarnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
          </div>
        )}

        {result.groups.length > 0 && (
          <div className="gen-copy-all">
            <Button size="sm" variant="outline" onClick={copyAll}>
              {copied?.key === 'all' && !copied.error ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />} <span>Copy All</span>
            </Button>
            {saveAction}
            <p className={`gen-copy-status ${copied?.error ? 'is-error' : ''}`} role="status" aria-live="polite">{copied?.text ?? ''}</p>
          </div>
        )}

        {result.groups.length > 0 && (
          <div className="gen-search">
            <div className="materials-toolbar__search">
              <Search size={16} aria-hidden="true" />
              <Input
                type="search"
                aria-label={manual ? 'Search your questions' : 'Search generated questions'}
                placeholder="Search by question text or type, e.g. “mcq” or “stack”"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <p className="muted gen-search__count" aria-live="polite">
              {searching ? `Showing ${visibleCount} of ${countQuestions(result.groups)} questions` : `${countQuestions(result.groups)} questions`}
            </p>
          </div>
        )}

        {searching && sections.length === 0 && (
          <>
            <StatusMessage state="empty" title="No questions found" text="No question matches your search. Try a different word or type." />
            <div className="gen-search__clear"><Button size="sm" variant="outline" onClick={() => setQuery('')}>Clear search</Button></div>
          </>
        )}

        {sections.map((section) => (
          <section key={section.questionType} className="gen-type">
            <h4 className="gen-type__title">
              {typeLabel(section.questionType)} <span className="tag tag--muted">{plural(section.total, 'question')}</span>
            </h4>
            {section.byMarks.map(({ marks, questions }) => (
              <div key={marks} className="gen-marks-group">
                <h5 className="gen-marks-group__title">
                  {marks} {marks === 1 ? 'mark' : 'marks'} <span className="muted">· {plural(questions.length, 'question')}</span>
                </h5>
                <ol className="gen-questions">
                  {questions.map((q, index) => (
                    <li key={q.questionId ?? `${marks}-${index}`} className="gen-question">
                      <p className="gen-question__text">{q.question}</p>
                      {Array.isArray(q.options) && q.options.length > 0 && (
                        <ul className="gen-options">
                          {q.options.map((option, i) => (
                            <li key={option.label ?? i}>
                              <span className="gen-options__label">{option.label ?? String.fromCharCode(65 + i)}</span>
                              <span>{option.text ?? option}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                      <div className="subject__tags">
                        {q.difficulty && <span className="tag tag--gold">{humanize(q.difficulty)}</span>}
                        <span className="tag tag--muted">{marks} {marks === 1 ? 'mark' : 'marks'}</span>
                      </div>
                      {manual && answers[q.questionId] && (
                        <div className="gen-answer">
                          <div className="gen-answer__head">
                            <p className="gen-answer__title">Model answer</p>
                            <CopyAnswerButton text={formatAnswerForCopy({ points: answers[q.questionId] })} label={`Copy answer for question: ${q.question}`} />
                          </div>
                          <ul className="gen-answer__points">
                            {answers[q.questionId].map((point, i) => <li key={i}>{point}</li>)}
                          </ul>
                        </div>
                      )}
                      <div className="gen-question__actions">
                        <Button size="sm" variant="ghost" onClick={() => copyOne(q, section.questionType, marks)} aria-label={`Copy question: ${q.question}`}>
                          {copied?.key === q.questionId && !copied.error ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />} <span>{copied?.key === q.questionId && !copied.error ? 'Copied' : 'Copy'}</span>
                        </Button>
                        {manual && (
                          <>
                          {onAnswer && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => onAnswer(q)}
                              loading={answeringIds.includes(q.questionId)}
                              disabled={answerDisabled}
                              aria-label={`${answers[q.questionId] ? 'Regenerate answer' : 'Generate answer'} for question: ${q.question}`}
                            >
                              {!answeringIds.includes(q.questionId) && <Sparkles size={14} aria-hidden="true" />} <span>{answers[q.questionId] ? 'Regenerate answer' : 'Generate answer'}</span>
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" onClick={() => onEdit?.(q)} disabled={busyId === q.questionId} aria-label={`Edit question: ${q.question}`}>
                            <Pencil size={14} aria-hidden="true" /> <span>{busyId === q.questionId ? 'Editing…' : 'Edit'}</span>
                          </Button>
                          <Button size="sm" variant="ghost" className="btn--danger" onClick={() => onDelete?.(q)} aria-label={`Delete question: ${q.question}`}>
                            <Trash2 size={14} aria-hidden="true" /> <span>Delete</span>
                          </Button>
                          </>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </section>
        ))}

        {(!manual || Object.keys(answers).length > 0) && (
          <div className="gen-disclaimer">
            <Alert variant="info">{manual ? MANUAL_ANSWER_NOTE : result.disclaimer || FALLBACK_DISCLAIMER}</Alert>
          </div>
        )}
        {!manual && <p className="muted gen-results__foot"><Info size={14} aria-hidden="true" /> Answers are not generated in this step.</p>}
      </div>
    </Card>
  )
}

export default QuestionResults

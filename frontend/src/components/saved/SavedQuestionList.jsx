import { formatAnswerForCopy, groupByType, typeLabel } from '../../utils/questionGeneration.js'
import { humanize } from '../../utils/academic.js'
import CopyAnswerButton from '../questions/CopyAnswerButton.jsx'
import { correctOptionText, hasAnswer, savedToGroups } from '../../utils/savedQuestions.js'

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

/** The answer of one saved question: the MCQ key and/or an explanation and/or model-answer points. Nothing when there is none. */
function SavedAnswer({ question }) {
  if (!hasAnswer(question)) return null
  const key = correctOptionText(question) || (question.correctAnswer ? `Option ${question.correctAnswer}` : '')
  const points = Array.isArray(question.answerPoints) ? question.answerPoints : []
  return (
    <div className="gen-answer">
      <div className="gen-answer__head">
        <p className="gen-answer__title">{key ? 'Answer' : 'Model answer'}</p>
        <CopyAnswerButton text={formatAnswerForCopy({ key, explanation: question.explanation, points })} label={`Copy answer for question: ${question.question}`} />
      </div>
      {key && <p className="saved-answer__key"><strong>Correct answer:</strong> {key}</p>}
      {question.explanation && <p className="saved-answer__text">{question.explanation}</p>}
      {points.length > 0 && <ul className="gen-answer__points">{points.map((point, i) => <li key={i}>{point}</li>)}</ul>}
    </div>
  )
}

/** A saved set's questions grouped by type and marks (the same layout as the generated questions), each with its stored answer. */
function SavedQuestionList({ questions }) {
  const sections = groupByType(savedToGroups(questions))
  return (
    <div className="gen-results">
      {sections.map((section) => (
        <section key={section.questionType} className="gen-type">
          <h4 className="gen-type__title">
            {typeLabel(section.questionType)} <span className="tag tag--muted">{plural(section.total, 'question')}</span>
          </h4>
          {section.byMarks.map(({ marks, questions: items }) => (
            <div key={marks} className="gen-marks-group">
              <h5 className="gen-marks-group__title">
                {marks} {marks === 1 ? 'mark' : 'marks'} <span className="muted">· {plural(items.length, 'question')}</span>
              </h5>
              <ol className="gen-questions">
                {items.map((q) => (
                  <li key={q.questionId} className="gen-question">
                    <p className="gen-question__text">{q.question}</p>
                    {Array.isArray(q.options) && q.options.length > 0 && (
                      <ul className="gen-options">
                        {q.options.map((option, i) => (
                          <li key={option.label ?? i}>
                            <span className="gen-options__label">{option.label}</span>
                            <span>{option.text}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="subject__tags">
                      {q.difficulty && <span className="tag tag--gold">{humanize(q.difficulty)}</span>}
                      <span className="tag tag--muted">{marks} {marks === 1 ? 'mark' : 'marks'}</span>
                      {q.unit && <span className="tag tag--muted">{q.unit}</span>}
                      {q.topic && <span className="tag tag--muted">{q.topic}</span>}
                    </div>
                    <SavedAnswer question={q} />
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </section>
      ))}
    </div>
  )
}

export default SavedQuestionList

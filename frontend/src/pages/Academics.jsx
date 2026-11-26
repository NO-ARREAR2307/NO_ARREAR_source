import AcademicSelector from '../components/academics/AcademicSelector.jsx'
import SubjectList from '../components/academics/SubjectList.jsx'
import { useEffect, useState } from 'react'
import { Alert, Card } from '../components/ui'
import useAcademicSelection from '../hooks/useAcademicSelection.js'
import useAuth from '../hooks/useAuth.js'

function Academics() {
  const { user, updateSemester, updateAcademics } = useAuth()
  const [saveResult, setSaveResult] = useState(null)
  // Course the student just picked; saved to the profile once its department has been resolved.
  const [pendingCourse, setPendingCourse] = useState(null)
  const selection = useAcademicSelection(user, async (number) => {
    setSaveResult(null)
    const result = await updateSemester(number)
    setSaveResult(result)
  })

  const { course, department, departments } = selection
  const departmentName = department?.name

  useEffect(() => {
    if (!pendingCourse || course !== pendingCourse || departments.loading || !departmentName) return
    setPendingCourse(null)
    if (user?.course === course && user?.department === departmentName) return
    updateAcademics({ course, department: departmentName }).then(setSaveResult)
  }, [pendingCourse, course, departmentName, departments.loading, user?.course, user?.department, updateAcademics])

  const handleCourse = (value) => {
    setSaveResult(null)
    selection.setCourse(value)
    setPendingCourse(value || null)
  }

  return (
    <>
      <header className="page-head">
        <h1 className="page-head__title">Academics</h1>
        <p className="muted">Pick your course and semester to see the subjects you study.</p>
      </header>
      <Card title="Academic selection" subtitle="Options load from your university’s academic data.">
        <AcademicSelector selection={{ ...selection, setCourse: handleCourse }} />
        {saveResult && !saveResult.ok && <div className="section"><Alert>{saveResult.message}</Alert></div>}
        {saveResult?.ok && saveResult.message && <div className="section"><Alert variant="info">{saveResult.message}</Alert></div>}
      </Card>
      <Card
        className="section"
        title={selection.selectedSemester ? `Semester ${selection.selectedSemester.semesterNumber} subjects` : 'Subjects'}
        subtitle={selection.subjects.options.length > 0 ? `${selection.subjects.options.length} subjects` : undefined}
      >
        <SubjectList semesterId={selection.semesterId} subjects={selection.subjects} />
      </Card>
    </>
  )
}

export default Academics

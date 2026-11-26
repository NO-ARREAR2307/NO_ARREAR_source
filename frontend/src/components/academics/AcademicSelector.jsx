import { Select } from '../ui'
import { courseOptions } from '../../utils/academic.js'

const toOptions = (list, label) => list.map((item) => ({ value: item._id, label: label(item) }))

/** The cascading dropdowns. All data comes from the `selection` object (see useAcademicSelection). */
function AcademicSelector({ selection: s }) {
  const departmentOptions = s.department ? [{ value: s.department._id, label: s.department.name }] : []
  const departmentHint = !s.universityId ? 'Select a university first' : !s.course ? 'Select a course first' : 'No matching department found'

  return (
    <div className="selector">
      <Select
        label="University"
        placeholder="Select university"
        options={toOptions(s.universities.options, (u) => u.name)}
        loading={s.universities.loading}
        loadError={s.universities.error}
        onRetry={s.universities.reload}
        emptyText="No universities available"
        value={s.universityId}
        onChange={(e) => s.setUniversity(e.target.value)}
      />
      <Select
        label="Course"
        placeholder="Select course"
        options={courseOptions}
        disabled={!s.universityId}
        disabledText="Select a university first"
        value={s.course}
        onChange={(e) => s.setCourse(e.target.value)}
      />
      <Select
        label="Department"
        disabled
        disabledText={departmentHint}
        options={departmentOptions}
        loading={Boolean(s.universityId && s.course) && s.departments.loading}
        loadError={s.course ? s.departments.error : ''}
        onRetry={s.departments.reload}
        value={s.department?._id ?? ''}
        onChange={() => {}}
        hint={s.department ? 'Set automatically from your course.' : undefined}
      />
      <Select
        label="Regulation"
        placeholder="Select regulation"
        disabled={!s.department}
        disabledText="Select a course first"
        emptyText="No regulations available"
        options={toOptions(s.regulations.options, (r) => r.name)}
        loading={s.regulations.loading}
        loadError={s.regulations.error}
        onRetry={s.regulations.reload}
        value={s.regulationId}
        onChange={(e) => s.setRegulation(e.target.value)}
      />
      <Select
        label="Semester"
        placeholder="Select semester"
        disabled={!s.regulationId}
        disabledText="Select a regulation first"
        emptyText="No semesters available"
        options={toOptions(s.semesterList, (x) => `Semester ${x.semesterNumber}`)}
        loading={s.semesters.loading}
        loadError={s.semesters.error}
        onRetry={s.semesters.reload}
        value={s.semesterId}
        onChange={(e) => s.setSemester(e.target.value)}
      />
    </div>
  )
}

export default AcademicSelector

import { Link, useNavigate } from 'react-router-dom'
import { Alert, Button, Input, Select } from '../components/ui'
import useForm from '../hooks/useForm.js'
import useOptions from '../hooks/useOptions.js'
import * as authService from '../services/authService.js'
import { SEMESTER_OPTIONS, getCourses, getDepartments, getUniversities } from '../services/academicCatalog.js'
import { setPendingEmail } from '../services/authStorage.js'
import { getErrorMessage, getFieldErrors } from '../utils/errors.js'
import { validators } from '../utils/validation.js'

const pick = (label) => (v) => (v ? '' : `Please select a ${label}`)

const rules = {
  name: (v) => validators.required('Name')(v) || (v.trim().length > 100 ? 'Name cannot exceed 100 characters' : ''),
  email: validators.email,
  password: validators.password,
  confirmPassword: (v, all) => (v === all.password ? '' : 'Passwords do not match'),
  university: pick('university'),
  course: pick('course'),
  department: pick('department'),
  semester: validators.semesterUg,
}

const initial = {
  name: '', email: '', password: '', confirmPassword: '',
  university: '', course: '', department: '', semester: '',
}

// `university` only drives the dependent dropdowns; the API receives name, email, password, course, department, semester.
function Register() {
  const navigate = useNavigate()
  const { values, errors, setErrors, formError, setFormError, submitting, handleChange, setFields, handleSubmit } = useForm(
    initial,
    rules,
  )

  const universities = useOptions(getUniversities, 'all')
  const courses = useOptions(getCourses, values.university)
  const departments = useOptions(getDepartments, values.course)

  const onUniversityChange = (e) => setFields({ university: e.target.value, course: '', department: '', semester: '' })
  const onCourseChange = (e) => setFields({ course: e.target.value, department: '', semester: '' })

  // The department is derived from the course and filled in automatically (the field is read-only).
  const departmentValue =
    values.department || (departments.options.length === 1 ? departments.options[0].value : '')

  const onSubmit = async (form) => {
    try {
      const { emailVerification } = await authService.register(form)
      const email = form.email.trim().toLowerCase()
      setPendingEmail(email)
      navigate('/verify-email', { state: { email, emailVerification } })
    } catch (err) {
      const fieldErrors = getFieldErrors(err)
      if (err.status === 409) fieldErrors.email = err.message
      setErrors(fieldErrors)
      setFormError(getErrorMessage(err))
    }
  }

  const field = (name) => ({ name, value: values[name], onChange: handleChange, error: errors[name] })

  return (
    <>
      <h1 className="auth__title">Create your account</h1>
      <p className="muted auth__lead">Join NO_ARREAR as a student.</p>
      <form className="form" onSubmit={handleSubmit(onSubmit, { department: departmentValue })} noValidate>
        <Alert>{formError}</Alert>
        <Input label="Full name" autoComplete="name" placeholder="Your name" {...field('name')} />
        <Input label="Email" type="email" autoComplete="email" placeholder="you@example.com" {...field('email')} />
        <div className="form__row">
          <Input label="Password" type="password" autoComplete="new-password" placeholder="Min. 8 characters" {...field('password')} />
          <Input label="Confirm password" type="password" autoComplete="new-password" placeholder="Repeat password" {...field('confirmPassword')} />
        </div>

        <Select
          label="University"
          name="university"
          placeholder="Select university"
          options={universities.options}
          loading={universities.loading}
          loadError={universities.error}
          onRetry={universities.reload}
          value={values.university}
          onChange={onUniversityChange}
          error={errors.university}
        />
        <div className="form__row">
          <Select
            label="Course"
            name="course"
            placeholder="Select course"
            disabled={!values.university}
            disabledText="Select a university first"
            emptyText="No courses available"
            options={courses.options}
            loading={courses.loading}
            loadError={courses.error}
            onRetry={courses.reload}
            value={values.course}
            onChange={onCourseChange}
            error={errors.course}
          />
          <Select
            label="Department"
            name="department"
            placeholder="Select department"
            disabled
            disabledText="Set from your course"
            emptyText="No departments available"
            options={departments.options}
            loading={departments.loading}
            loadError={departments.error}
            onRetry={departments.reload}
            value={departmentValue}
            onChange={() => {}}
            error={errors.department}
            hint={departmentValue ? 'Set automatically from your course.' : undefined}
          />
        </div>
        <Select
          label="Semester"
          name="semester"
          placeholder="Select semester"
          options={SEMESTER_OPTIONS}
          value={values.semester}
          onChange={handleChange}
          error={errors.semester}
        />
        <Button type="submit" fullWidth size="lg" loading={submitting} disabled={departments.loading}>
          {submitting ? 'Creating account…' : 'Create account'}
        </Button>
      </form>
      <p className="auth__alt">
        Already registered? <Link to="/login">Log in</Link>
      </p>
    </>
  )
}

export default Register

import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Alert, Button, Input } from '../components/ui'
import useAuth from '../hooks/useAuth.js'
import useForm from '../hooks/useForm.js'
import * as authService from '../services/authService.js'
import { setPendingEmail } from '../services/authStorage.js'
import { getErrorMessage, getFieldErrors } from '../utils/errors.js'
import { validators } from '../utils/validation.js'

const rules = {
  email: validators.email,
  password: (v) => (v ? '' : 'Password is required'),
}

function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const { values, errors, setErrors, formError, setFormError, submitting, handleChange, handleSubmit } = useForm(
    { email: '', password: '' },
    rules,
  )

  const onSubmit = async ({ email, password }) => {
    try {
      const { user, token } = await authService.login(email, password)
      login({ user, token })
      navigate(location.state?.from || '/dashboard', { replace: true })
    } catch (err) {
      // Backend answers 403 + code EMAIL_NOT_VERIFIED after a correct password.
      if (err.status === 403 && err.data?.code === 'EMAIL_NOT_VERIFIED') {
        setPendingEmail(email.trim().toLowerCase())
        navigate('/verify-email', { state: { email: email.trim().toLowerCase(), notice: err.message } })
        return
      }
      setErrors(getFieldErrors(err))
      setFormError(getErrorMessage(err))
    }
  }

  return (
    <>
      <h1 className="auth__title">Welcome back</h1>
      <p className="muted auth__lead">Log in to continue preparing.</p>
      <form className="form" onSubmit={handleSubmit(onSubmit)} noValidate>
        {location.state?.notice && <Alert variant="success">{location.state.notice}</Alert>}
        <Alert>{formError}</Alert>
        <Input label="Email" name="email" type="email" autoComplete="email" placeholder="you@example.com"
          value={values.email} onChange={handleChange} error={errors.email} />
        <Input label="Password" name="password" type="password" autoComplete="current-password" placeholder="Your password"
          value={values.password} onChange={handleChange} error={errors.password} />
        <div className="auth__forgot">
          <Link to="/forgot-password">Forgot password?</Link>
        </div>
        <Button type="submit" fullWidth size="lg" loading={submitting}>
          {submitting ? 'Logging in…' : 'Log in'}
        </Button>
      </form>
      <p className="auth__alt">
        New to NO_ARREAR? <Link to="/register">Create an account</Link>
      </p>
    </>
  )
}

export default Login

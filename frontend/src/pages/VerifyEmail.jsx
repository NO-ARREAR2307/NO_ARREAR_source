import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Alert, Button, Input } from '../components/ui'
import useAuth from '../hooks/useAuth.js'
import useForm from '../hooks/useForm.js'
import * as authService from '../services/authService.js'
import { getPendingEmail, setPendingEmail } from '../services/authStorage.js'
import { getErrorMessage, getFieldErrors } from '../utils/errors.js'
import { validators } from '../utils/validation.js'

function VerifyEmail() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const { state } = useLocation()
  const email = state?.email || getPendingEmail()
  const verification = state?.emailVerification

  // Registration tells us whether the first code was actually sent, and the resend cooldown.
  const [notice, setNotice] = useState(() => {
    if (state?.notice) return { variant: 'info', text: state.notice }
    if (verification?.otpSent === false) return { variant: 'error', text: verification.message }
    if (verification?.otpSent) return { variant: 'success', text: `${verification.message} (${verification.sentTo})` }
    return null
  })
  const [cooldown, setCooldown] = useState(verification?.otpSent ? verification.resendCooldownSeconds || 0 : 0)
  const [resending, setResending] = useState(false)

  const { values, errors, setErrors, formError, setFormError, submitting, handleChange, handleSubmit } = useForm(
    { email: email || '', otp: '' },
    { email: validators.email, otp: validators.otp },
  )

  useEffect(() => {
    if (cooldown <= 0) return undefined
    const timer = setInterval(() => setCooldown((s) => Math.max(0, s - 1)), 1000)
    return () => clearInterval(timer)
  }, [cooldown > 0]) // eslint-disable-line react-hooks/exhaustive-deps

  const onVerify = async ({ email: addr, otp }) => {
    try {
      const { user, token } = await authService.verifyEmail(addr, otp)
      setPendingEmail('')
      login({ user, token })
      navigate('/dashboard', { replace: true })
    } catch (err) {
      setErrors(getFieldErrors(err))
      const left = err.data?.attemptsRemaining
      setFormError(Number.isInteger(left) ? `${err.message} (${left} attempt${left === 1 ? '' : 's'} left)` : getErrorMessage(err))
    }
  }

  const onResend = async () => {
    const found = validators.email(values.email)
    if (found) return setErrors({ email: found })
    setResending(true)
    setFormError('')
    try {
      const res = await authService.resendOtp(values.email)
      setPendingEmail(values.email.trim().toLowerCase())
      setNotice({ variant: 'success', text: res.message })
      setCooldown(res.data?.resendCooldownSeconds || 60)
    } catch (err) {
      if (err.status === 429 && err.data?.retryAfterSeconds) setCooldown(err.data.retryAfterSeconds)
      setNotice(null)
      setFormError(getErrorMessage(err))
    } finally {
      setResending(false)
    }
  }

  return (
    <>
      <h1 className="auth__title">Verify your email</h1>
      <p className="muted auth__lead">
        {email ? <>Enter the 6-digit code we sent to <strong>{email}</strong>.</> : 'Enter your email and the 6-digit code we sent you.'}
      </p>
      <form className="form" onSubmit={handleSubmit(onVerify)} noValidate>
        {notice && <Alert variant={notice.variant}>{notice.text}</Alert>}
        <Alert>{formError}</Alert>
        {!email && (
          <Input label="Email" name="email" type="email" autoComplete="email" placeholder="you@example.com"
            value={values.email} onChange={handleChange} error={errors.email} />
        )}
        <Input label="Verification code" name="otp" className="otp" inputMode="numeric" autoComplete="one-time-code"
          maxLength={6} placeholder="••••••" value={values.otp} onChange={handleChange} error={errors.otp} />
        <Button type="submit" fullWidth size="lg" loading={submitting}>
          {submitting ? 'Verifying…' : 'Verify email'}
        </Button>
      </form>
      <div className="auth__resend">
        <span className="muted">Didn&apos;t get a code?</span>
        <Button variant="ghost" size="sm" onClick={onResend} loading={resending} disabled={cooldown > 0}>
          {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
        </Button>
      </div>
      <p className="auth__alt">
        <Link to="/login">Back to log in</Link>
      </p>
    </>
  )
}

export default VerifyEmail

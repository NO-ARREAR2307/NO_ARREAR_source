import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Alert, Button, Input } from '../components/ui'
import useForm from '../hooks/useForm.js'
import * as authService from '../services/authService.js'
import { getErrorMessage, getFieldErrors } from '../utils/errors.js'
import { validators } from '../utils/validation.js'

const STEPS = ['email', 'otp', 'reset']
const DEFAULT_COOLDOWN = 60

const emailRules = { email: validators.email }
const otpRules = { otp: validators.otp }
const resetRules = {
  password: validators.password,
  confirmPassword: (v, all) => (v ? (v === all.password ? '' : 'Passwords do not match') : 'Please confirm your password'),
}

/** Progress bar shared by the three steps. */
function Steps({ current }) {
  const index = STEPS.indexOf(current)
  return (
    <div className="auth__steps" role="img" aria-label={`Step ${index + 1} of ${STEPS.length}`}>
      {STEPS.map((s, i) => (
        <span key={s} className={`auth__step ${i <= index ? 'auth__step--done' : ''}`} />
      ))}
    </div>
  )
}

/** Step 1: ask for the account email and request an OTP. */
function EmailStep({ initialEmail, onSent }) {
  const { values, errors, setErrors, formError, setFormError, submitting, handleChange, handleSubmit } = useForm(
    { email: initialEmail },
    emailRules,
  )

  const onSubmit = async ({ email }) => {
    try {
      const res = await authService.forgotPassword(email)
      onSent({ email: email.trim().toLowerCase(), message: res?.message, cooldown: res?.data?.resendCooldownSeconds })
    } catch (err) {
      setErrors(getFieldErrors(err))
      setFormError(getErrorMessage(err))
    }
  }

  return (
    <>
      <Steps current="email" />
      <h1 className="auth__title">Forgot your password?</h1>
      <p className="muted auth__lead">Enter your account email and we&apos;ll send you a 6-digit code to reset it.</p>
      <form className="form" onSubmit={handleSubmit(onSubmit)} noValidate>
        <Alert>{formError}</Alert>
        <Input label="Email" name="email" type="email" autoComplete="email" placeholder="you@example.com"
          value={values.email} onChange={handleChange} error={errors.email} />
        <Button type="submit" fullWidth size="lg" loading={submitting}>
          {submitting ? 'Sending code…' : 'Send reset code'}
        </Button>
      </form>
      <p className="auth__alt">
        Remembered it? <Link to="/login">Back to log in</Link>
      </p>
    </>
  )
}

/** Step 2: enter the OTP (with resend + cooldown). */
function OtpStep({ email, notice, initialCooldown, onVerified, onChangeEmail }) {
  const [info, setInfo] = useState(notice)
  const [cooldown, setCooldown] = useState(initialCooldown)
  const [resending, setResending] = useState(false)

  const { values, errors, setErrors, formError, setFormError, submitting, handleChange, handleSubmit } = useForm(
    { otp: '' },
    otpRules,
  )

  useEffect(() => {
    if (cooldown <= 0) return undefined
    const timer = setInterval(() => setCooldown((s) => Math.max(0, s - 1)), 1000)
    return () => clearInterval(timer)
  }, [cooldown > 0]) // eslint-disable-line react-hooks/exhaustive-deps

  const onSubmit = async ({ otp }) => {
    try {
      const res = await authService.verifyResetOtp(email, otp)
      const resetToken = res?.resetToken || res?.data?.resetToken || res?.token || ''
      onVerified({ otp: otp.trim(), resetToken })
    } catch (err) {
      setErrors(getFieldErrors(err))
      const left = err.data?.attemptsRemaining
      setFormError(Number.isInteger(left) ? `${err.message} (${left} attempt${left === 1 ? '' : 's'} left)` : getErrorMessage(err))
    }
  }

  const onResend = async () => {
    setResending(true)
    setFormError('')
    try {
      const res = await authService.forgotPassword(email)
      setInfo(res?.message || 'A new code has been sent.')
      setCooldown(res?.data?.resendCooldownSeconds || DEFAULT_COOLDOWN)
    } catch (err) {
      if (err.status === 429 && err.data?.retryAfterSeconds) setCooldown(err.data.retryAfterSeconds)
      setInfo('')
      setFormError(getErrorMessage(err))
    } finally {
      setResending(false)
    }
  }

  return (
    <>
      <Steps current="otp" />
      <h1 className="auth__title">Enter the code</h1>
      <p className="muted auth__lead">
        We sent a 6-digit code to <strong>{email}</strong>.{' '}
        <button type="button" className="link-btn" onClick={onChangeEmail}>Change email</button>
      </p>
      <form className="form" onSubmit={handleSubmit(onSubmit)} noValidate>
        {info && <Alert variant="success">{info}</Alert>}
        <Alert>{formError}</Alert>
        <Input label="Reset code" name="otp" className="otp" inputMode="numeric" autoComplete="one-time-code"
          maxLength={6} placeholder="••••••" value={values.otp} onChange={handleChange} error={errors.otp} />
        <Button type="submit" fullWidth size="lg" loading={submitting}>
          {submitting ? 'Verifying…' : 'Verify code'}
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

/** Step 3: choose a new password. */
function ResetStep({ email, otp, resetToken, onRestart }) {
  const navigate = useNavigate()
  const { values, errors, setErrors, formError, setFormError, submitting, handleChange, handleSubmit } = useForm(
    { password: '', confirmPassword: '' },
    resetRules,
  )
  const [expired, setExpired] = useState(false)

  const onSubmit = async ({ password }) => {
    try {
      const res = await authService.resetPassword({ email, otp, resetToken, password })
      navigate('/login', {
        replace: true,
        state: { notice: res?.message || 'Your password has been reset. Please log in with your new password.' },
      })
    } catch (err) {
      setErrors(getFieldErrors(err))
      setFormError(getErrorMessage(err))
      // A used/expired code can't be retried on this screen.
      if (err.status === 400 || err.status === 401 || err.status === 410) setExpired(true)
    }
  }

  return (
    <>
      <Steps current="reset" />
      <h1 className="auth__title">Set a new password</h1>
      <p className="muted auth__lead">Choose a strong password for <strong>{email}</strong>.</p>
      <form className="form" onSubmit={handleSubmit(onSubmit)} noValidate>
        <Alert variant="success">Code verified. You can now set a new password.</Alert>
        <Alert>{formError}</Alert>
        <Input label="New password" name="password" type="password" autoComplete="new-password" placeholder="Min. 8 characters"
          value={values.password} onChange={handleChange} error={errors.password} />
        <Input label="Confirm new password" name="confirmPassword" type="password" autoComplete="new-password" placeholder="Repeat password"
          value={values.confirmPassword} onChange={handleChange} error={errors.confirmPassword} />
        <Button type="submit" fullWidth size="lg" loading={submitting}>
          {submitting ? 'Resetting password…' : 'Reset password'}
        </Button>
      </form>
      {expired && (
        <p className="auth__alt">
          <button type="button" className="link-btn" onClick={onRestart}>Request a new code</button>
        </p>
      )}
      <p className="auth__alt">
        <Link to="/login">Back to log in</Link>
      </p>
    </>
  )
}

function ForgotPassword() {
  const [step, setStep] = useState('email')
  const [flow, setFlow] = useState({ email: '', notice: '', cooldown: 0, otp: '', resetToken: '' })

  if (step === 'otp') {
    return (
      <OtpStep
        email={flow.email}
        notice={flow.notice}
        initialCooldown={flow.cooldown}
        onChangeEmail={() => setStep('email')}
        onVerified={({ otp, resetToken }) => {
          setFlow((f) => ({ ...f, otp, resetToken }))
          setStep('reset')
        }}
      />
    )
  }

  if (step === 'reset') {
    return (
      <ResetStep
        email={flow.email}
        otp={flow.otp}
        resetToken={flow.resetToken}
        onRestart={() => setStep('email')}
      />
    )
  }

  return (
    <EmailStep
      initialEmail={flow.email}
      onSent={({ email, message, cooldown }) => {
        setFlow({ email, notice: message || 'We sent a reset code to your email.', cooldown: cooldown || DEFAULT_COOLDOWN, otp: '', resetToken: '' })
        setStep('otp')
      }}
    />
  )
}

export default ForgotPassword

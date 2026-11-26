import { get, post, put } from './api.js'

// Endpoints and payloads follow the backend: routes/authRoutes.js + controllers/authController.js

/** POST /auth/register → { success, message, user, emailVerification } (no token until verified) */
export const register = ({ name, email, password, course, department, semester }) =>
  post('/auth/register', {
    name: name.trim(),
    email: email.trim().toLowerCase(),
    password,
    course: course.trim(),
    department: department.trim(),
    semester: Number(semester),
  })

/** POST /auth/verify-email → { success, message, user, token } */
export const verifyEmail = (email, otp) =>
  post('/auth/verify-email', { email: email.trim().toLowerCase(), otp: otp.trim() })

/** POST /auth/resend-otp → { success, message, data: { expiresInSeconds, resendCooldownSeconds } } */
export const resendOtp = (email) => post('/auth/resend-otp', { email: email.trim().toLowerCase() })

/** POST /auth/login → { success, message, user, token } */
export const login = (email, password) =>
  post('/auth/login', { email: email.trim().toLowerCase(), password })

/** GET /auth/profile (Bearer token) → { success, message, user } */
export const getProfile = () => get('/auth/profile')

/**
 * PUT /auth/profile (Bearer token) { semester } → { success, message, user }
 * NOTE: the backend's profile-update route could not be inspected from the frontend. This is the conventional
 * counterpart of GET /auth/profile; if the real route differs, only this function needs to change.
 */
export const updateProfile = (changes) => put('/auth/profile', changes)

/**
 * POST /auth/forgot-password → { success, message, ... }
 * Sends a password-reset OTP to the email (backend may answer generically for unknown emails).
 */
export const forgotPassword = (email) => post('/auth/forgot-password', { email: email.trim().toLowerCase() })

/**
 * POST /auth/verify-reset-otp → { success, message, resetToken? }
 * If the backend returns a reset token it is handed back so it can be sent with the reset request.
 */
export const verifyResetOtp = (email, otp) =>
  post('/auth/verify-reset-otp', { email: email.trim().toLowerCase(), otp: otp.trim() })

/**
 * POST /auth/reset-password → { success, message }
 * Sends the verified email + OTP (and the reset token when the verify step returned one).
 * The new password is sent as both `password` and `newPassword` so either backend field name is accepted.
 */
export const resetPassword = ({ email, otp, resetToken, password }) =>
  post('/auth/reset-password', {
    email: email.trim().toLowerCase(),
    otp: otp.trim(),
    ...(resetToken ? { resetToken } : {}),
    password,
    newPassword: password,
  })

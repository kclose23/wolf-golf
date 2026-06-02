import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import Spinner from '../components/Spinner'

const SAVED_EMAIL_KEY = 'wolf_golf_auth_email'

export default function AuthScreen({ onSkip }) {
  const savedEmail = localStorage.getItem(SAVED_EMAIL_KEY) || ''
  const [email, setEmail] = useState(savedEmail)
  const [mode, setMode] = useState('login')
  const [step, setStep] = useState(savedEmail ? 'auto-sending' : 'email')
  const [otp, setOtp] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Returning user: auto-send OTP immediately, skip the form
  useEffect(() => {
    if (savedEmail) {
      sendOtp(savedEmail, false)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function sendOtp(emailAddr, shouldCreateUser) {
    setError('')
    setLoading(true)
    try {
      const { error: err } = await supabase.auth.signInWithOtp({
        email: emailAddr.trim(),
        options: { shouldCreateUser, emailRedirectTo: window.location.origin },
      })
      if (err) throw err
      setStep('otp')
    } catch (err) {
      setError(err.message)
      setStep('email')
    } finally {
      setLoading(false)
    }
  }

  async function handleSendCode(e) {
    e.preventDefault()
    await sendOtp(email, mode === 'signup')
  }

  async function handleVerifyOtp(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const { error: err } = await supabase.auth.verifyOtp({
        email: email.trim(),
        token: otp.trim(),
        type: 'email',
      })
      if (err) throw err
      localStorage.setItem(SAVED_EMAIL_KEY, email.trim())
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  function switchMode(m) {
    setMode(m)
    setError('')
    setOtp('')
    setStep('email')
    if (m === 'signup') setEmail('')
  }

  // ── Auto-sending spinner ──────────────────────────────────────────────────

  if (step === 'auto-sending') {
    return (
      <div className="min-h-screen bg-gray-900 flex flex-col items-center justify-center p-6 max-w-md mx-auto">
        <img src="/logo.svg" alt="Wolf Golf" className="w-24 h-24 mb-4 rounded-2xl" />
        <h1 className="text-3xl font-bold text-white mb-1">Wolf Golf</h1>
        <p className="text-gray-400 text-sm mb-8">Signing you back in…</p>
        <Spinner size="lg" />
      </div>
    )
  }

  // ── OTP verification step ─────────────────────────────────────────────────

  if (step === 'otp') {
    return (
      <div className="min-h-screen bg-gray-900 flex flex-col items-center justify-center p-6 max-w-md mx-auto">
        <img src="/logo.svg" alt="Wolf Golf" className="w-24 h-24 mb-4 rounded-2xl" />
        <h1 className="text-3xl font-bold text-white mb-1">Wolf Golf</h1>
        <p className="text-gray-400 text-sm mb-8">Check your email</p>

        <form onSubmit={handleVerifyOtp} className="w-full space-y-4">
          <div className="bg-green-950 border border-green-900 rounded-xl p-4 text-center">
            <p className="text-sm text-gray-400">We sent a sign-in link to</p>
            <p className="font-semibold text-white">{email}</p>
            <p className="text-sm text-gray-400 mt-2">
              Tap the link in the email, or enter the 6-digit code below.
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1.5">6-digit code</label>
            <input
              type="text"
              inputMode="numeric"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="000000"
              className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-4 text-center text-3xl font-mono tracking-[0.5em] focus:outline-none focus:ring-2 focus:ring-green-500 placeholder-gray-700"
              autoFocus
            />
          </div>
          {error && <p className="text-red-400 text-sm text-center">{error}</p>}
          <button
            type="submit"
            disabled={otp.length !== 6 || loading}
            className="w-full bg-green-600 text-white py-3.5 rounded-xl font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? <Spinner size="sm" /> : 'Verify & Sign In'}
          </button>
          <button
            type="button"
            onClick={() => { setStep('email'); setOtp(''); setError('') }}
            className="w-full text-sm text-gray-500 py-2"
          >
            Use a different email
          </button>
        </form>

        {onSkip && (
          <>
            <div className="flex items-center gap-3 w-full mt-2">
              <div className="flex-1 h-px bg-gray-800" />
              <span className="text-xs text-gray-600">or</span>
              <div className="flex-1 h-px bg-gray-800" />
            </div>
            <button
              onClick={onSkip}
              className="w-full border border-gray-700 text-gray-400 py-3 rounded-xl text-sm font-medium mt-2"
            >
              Continue without account
            </button>
          </>
        )}
      </div>
    )
  }

  // ── Email entry step (new users or fallback) ──────────────────────────────

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col items-center justify-center p-6 max-w-md mx-auto">
      <img src="/logo.svg" alt="Wolf Golf" className="w-24 h-24 mb-4 rounded-2xl" />
      <h1 className="text-3xl font-bold text-white mb-1">Wolf Golf</h1>
      <p className="text-gray-400 text-sm mb-8">Track your game history across every trip</p>

      <div className="w-full space-y-4">
        <div className="flex rounded-xl bg-gray-800 p-1 w-full">
          <button
            onClick={() => switchMode('login')}
            className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-colors
              ${mode === 'login' ? 'bg-gray-700 text-white shadow' : 'text-gray-500'}`}
          >
            Log In
          </button>
          <button
            onClick={() => switchMode('signup')}
            className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-colors
              ${mode === 'signup' ? 'bg-gray-700 text-white shadow' : 'text-gray-500'}`}
          >
            Create Account
          </button>
        </div>

        <form onSubmit={handleSendCode} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1.5">Email address</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-green-500 placeholder-gray-600"
              autoFocus
              autoComplete="email"
            />
          </div>
          {error && <p className="text-red-400 text-sm text-center">{error}</p>}
          <button
            type="submit"
            disabled={!email.trim() || loading}
            className="w-full bg-green-600 text-white py-3.5 rounded-xl font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? <Spinner size="sm" /> : mode === 'login' ? 'Log In' : 'Create Account'}
          </button>
        </form>

        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-gray-800" />
          <span className="text-xs text-gray-600">or</span>
          <div className="flex-1 h-px bg-gray-800" />
        </div>

        <button
          onClick={onSkip}
          className="w-full border border-gray-700 text-gray-400 py-3 rounded-xl text-sm font-medium"
        >
          Continue without account
        </button>
        <p className="text-xs text-gray-600 text-center">
          You can still join and score games — history won't be saved.
        </p>
      </div>
    </div>
  )
}

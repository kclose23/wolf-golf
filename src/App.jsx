import { useState } from 'react'
import { AppProvider, useApp } from './context/AppContext'
import { completeTrip } from './lib/db'
import AuthScreen from './screens/AuthScreen'
import HistoryScreen from './screens/HistoryScreen'
import HomeScreen from './screens/HomeScreen'
import PlayerSelectScreen from './screens/PlayerSelectScreen'
import AdminSetupScreen from './screens/AdminSetupScreen'
import CourseScanScreen from './screens/CourseScanScreen'
import ScoringScreen from './screens/ScoringScreen'
import LeaderboardScreen from './screens/LeaderboardScreen'
import SettlementScreen from './screens/SettlementScreen'
import Spinner from './components/Spinner'

function AppInner() {
  const { state, actions } = useApp()
  const { loading, authLoading, user, tripId, playerId, rounds, activeRoundId, isAdmin } = state

  const [overlayScreen, setOverlayScreen] = useState(null) // 'setup' | 'scan' | null
  const [showNewGame, setShowNewGame] = useState(false)
  const [mainScreen, setMainScreen] = useState('score')
  const [completing, setCompleting] = useState(false)
  const [skippedAuth, setSkippedAuth] = useState(
    () => localStorage.getItem('wolf_golf_skip_auth') === 'true'
  )

  const hasPickedPlayer = Boolean(playerId)
  const activeRound = rounds.find((r) => r.id === activeRoundId)
  const hasActiveRound = Boolean(activeRoundId && activeRound)

  // Auth loading spinner
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Spinner size="lg" />
          <p className="text-gray-400 text-sm">Loading…</p>
        </div>
      </div>
    )
  }

  // Not signed in → auth screen (unless skipped)
  if (!user && !skippedAuth) {
    return (
      <AuthScreen
        onSkip={() => {
          localStorage.setItem('wolf_golf_skip_auth', 'true')
          setSkippedAuth(true)
        }}
      />
    )
  }

  // Signed in with no trip, or skipped auth with no trip → home/history
  if (!tripId || showNewGame) {
    if (!user || showNewGame) {
      return (
        <HomeScreen
          onBack={showNewGame ? () => setShowNewGame(false) : null}
          onJoined={(opts) => {
            setShowNewGame(false)
            if (opts?.newTrip && opts?.isAdmin) setOverlayScreen('setup')
          }}
        />
      )
    }
    return (
      <HistoryScreen
        onNewGame={() => setShowNewGame(true)}
      />
    )
  }

  // Trip joined but no player picked
  if (!hasPickedPlayer) {
    return (
      <PlayerSelectScreen
        onSelected={() => {
          if (state.isAdmin && rounds.length === 0) setOverlayScreen('setup')
        }}
        onBack={() => {
          actions.clearSession()
          setShowNewGame(false)
        }}
      />
    )
  }

  // Trip data loading
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Spinner size="lg" />
          <p className="text-gray-400 text-sm">Loading…</p>
        </div>
      </div>
    )
  }

  // ── Overlay screens ────────────────────────────────────────────────────

  if (overlayScreen === 'setup') {
    return <AdminSetupScreen onDone={() => setOverlayScreen(null)} onBack={() => setOverlayScreen(null)} />
  }

  if (overlayScreen === 'scan') {
    return <CourseScanScreen onBack={() => setOverlayScreen(null)} onSaved={() => setOverlayScreen(null)} />
  }

  // ── Main app ───────────────────────────────────────────────────────────

  return (
    <div className="relative">
      {/* Admin toolbar */}
      {isAdmin && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-yellow-50 border-b border-yellow-200 flex items-center px-4 py-1.5 gap-2 max-w-md mx-auto text-xs">
          <span className="font-semibold text-yellow-800">Admin</span>
          <span className="text-yellow-600 truncate">Code: <span className="font-mono font-bold tracking-widest">{state.joinCode}</span></span>
          <div className="flex-1" />
          <button
            onClick={() => setOverlayScreen('setup')}
            className="bg-yellow-100 text-yellow-800 px-2 py-1 rounded font-medium whitespace-nowrap"
          >
            + Round
          </button>
          <button
            onClick={() => setOverlayScreen('scan')}
            className="bg-yellow-100 text-yellow-800 px-2 py-1 rounded font-medium"
          >
            Scan
          </button>
          <button
            disabled={completing}
            onClick={async () => {
              if (!confirm('Mark this game as complete? Scoring will be locked for everyone.')) return
              setCompleting(true)
              try {
                await completeTrip(state.tripId)
                await actions.reload()
                actions.clearSession()
              } catch (err) {
                alert(err.message)
              } finally {
                setCompleting(false)
              }
            }}
            className="bg-red-100 text-red-700 px-2 py-1 rounded font-medium whitespace-nowrap disabled:opacity-50"
          >
            {completing ? '…' : 'End Game'}
          </button>
        </div>
      )}

      {/* No active round prompt */}
      {!hasActiveRound && !isAdmin && (
        <div className="fixed inset-0 flex items-center justify-center bg-gray-900 z-40 p-8">
          <div className="text-center">
            <div className="text-4xl mb-4">⏳</div>
            <h2 className="font-semibold text-white mb-2">Waiting for admin to set up a round</h2>
            <p className="text-sm text-gray-500">Ask the trip admin to create Round 1 and assign groups.</p>
          </div>
        </div>
      )}

      {/* Main screens */}
      <div className={isAdmin ? 'pt-9' : ''}>
        {mainScreen === 'score' && <ScoringScreen setScreen={setMainScreen} />}
        {mainScreen === 'leaderboard' && <LeaderboardScreen setScreen={setMainScreen} />}
        {mainScreen === 'settlement' && <SettlementScreen setScreen={setMainScreen} />}
      </div>
    </div>
  )
}

export default function App() {
  return (
    <AppProvider>
      <AppInner />
    </AppProvider>
  )
}

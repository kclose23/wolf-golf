import { useState, useEffect } from 'react'
import { AppProvider, useApp } from './context/AppContext'
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
  const { loading, tripId, playerId, players, rounds, activeRoundId } = state

  // Screens outside the main tab nav
  const [overlayScreen, setOverlayScreen] = useState(null) // 'setup' | 'scan' | null
  // Main tab
  const [mainScreen, setMainScreen] = useState('score')

  // Derived auth state
  const isLoggedIn = Boolean(tripId && playerId)
  const hasPickedPlayer = Boolean(playerId)
  const myPlayer = players.find((p) => p.id === playerId)
  const isAdmin = myPlayer?.is_admin || false

  const activeRound = rounds.find((r) => r.id === activeRoundId)
  const hasActiveRound = Boolean(activeRoundId && activeRound)
  const course = state.courses.find((c) => c.round_number === activeRound?.round_number)
  const courseScanned = Boolean(course?.holes?.length)

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

  // ── Auth / setup flow ──────────────────────────────────────────────────

  if (!tripId) {
    return <HomeScreen onJoined={(opts) => {
      if (opts?.newTrip && opts?.isAdmin) {
        // Already set player, go to setup
        setOverlayScreen('setup')
      }
    }} />
  }

  if (!hasPickedPlayer) {
    return <PlayerSelectScreen onSelected={(player) => {
      // If admin and no rounds, push to setup
      if (player.is_admin && rounds.length === 0) setOverlayScreen('setup')
    }} />
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
        <div className="fixed top-0 left-0 right-0 z-50 bg-yellow-50 border-b border-yellow-200 flex items-center px-4 py-1.5 gap-3 max-w-md mx-auto text-xs">
          <span className="font-semibold text-yellow-800">Admin</span>
          <span className="text-yellow-600">Code: <span className="font-mono font-bold tracking-widest">{state.joinCode}</span></span>
          <div className="flex-1" />
          <button
            onClick={() => setOverlayScreen('setup')}
            className="bg-yellow-100 text-yellow-800 px-2 py-1 rounded font-medium"
          >
            + Round
          </button>
          <button
            onClick={() => setOverlayScreen('scan')}
            className="bg-yellow-100 text-yellow-800 px-2 py-1 rounded font-medium"
          >
            Scan
          </button>
        </div>
      )}

      {/* No active round prompt */}
      {!hasActiveRound && !isAdmin && (
        <div className="fixed inset-0 flex items-center justify-center bg-white z-40 p-8">
          <div className="text-center">
            <div className="text-4xl mb-4">⏳</div>
            <h2 className="font-semibold text-gray-800 mb-2">Waiting for admin to set up a round</h2>
            <p className="text-sm text-gray-400">Ask the trip admin to create Round 1 and assign groups.</p>
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

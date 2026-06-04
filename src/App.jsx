import { useState } from 'react'
import { AppProvider, useApp } from './context/AppContext'
import { completeTrip, setRoundStatus, deleteRound, updatePlayerHandicap } from './lib/db'
import AuthScreen from './screens/AuthScreen'
import HistoryScreen from './screens/HistoryScreen'
import HomeScreen from './screens/HomeScreen'
import PlayerSelectScreen from './screens/PlayerSelectScreen'
import AdminSetupScreen from './screens/AdminSetupScreen'
import TripSetupScreen from './screens/TripSetupScreen'
import CourseScanScreen from './screens/CourseScanScreen'
import ScoringScreen from './screens/ScoringScreen'
import LeaderboardScreen from './screens/LeaderboardScreen'
import SettlementScreen from './screens/SettlementScreen'
import Spinner from './components/Spinner'

function AppInner() {
  const { state, actions } = useApp()
  const { loading, authLoading, user, tripId, playerId, rounds, activeRoundId, isAdmin } = state

  const [overlayScreen, setOverlayScreen] = useState(null) // 'setup' | 'trip-setup' | 'scan' | 'round-hub'
  const [showNewGame, setShowNewGame] = useState(false)
  const [mainScreen, setMainScreen] = useState('score')
  const [completing, setCompleting] = useState(false)
  const [startingRound, setStartingRound] = useState(null)
  const [deletingRound, setDeletingRound] = useState(null)
  const [skippedAuth, setSkippedAuth] = useState(
    () => localStorage.getItem('wolf_golf_skip_auth') === 'true'
  )

  const hasPickedPlayer = Boolean(playerId)
  const activeRound = rounds.find((r) => r.id === activeRoundId)
  const hasActiveRound = Boolean(activeRoundId && activeRound && activeRound.status !== 'pending')

  const sortedRounds = [...rounds].sort((a, b) => a.round_number - b.round_number)
  const pendingRounds = sortedRounds.filter((r) => r.status === 'pending')
  const nextPendingRound = pendingRounds[0] || null
  const hasPendingRounds = pendingRounds.length > 0

  async function handleDeleteRound(roundId) {
    if (!confirm('Delete this round and all its scores? This cannot be undone.')) return
    setDeletingRound(roundId)
    try {
      await deleteRound(roundId)
      await actions.reload()
    } catch (err) {
      alert(err.message)
    } finally {
      setDeletingRound(null)
    }
  }

  async function handleStartRound(roundId) {
    setStartingRound(roundId)
    try {
      await setRoundStatus(roundId, 'active')
      actions.setActiveRound(roundId)
      await actions.reload()
      setOverlayScreen(null)
    } catch (err) {
      alert(err.message)
    } finally {
      setStartingRound(null)
    }
  }

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

  // No trip → home/history
  if (!tripId || showNewGame) {
    if (!user || showNewGame) {
      return (
        <HomeScreen
          onBack={showNewGame ? () => setShowNewGame(false) : null}
          onJoined={(opts) => {
            setShowNewGame(false)
            if (opts?.newTrip && opts?.isAdmin) setOverlayScreen('setup-choice')
          }}
        />
      )
    }
    return <HistoryScreen onNewGame={() => setShowNewGame(true)} />
  }

  // Trip joined but no player picked
  if (!hasPickedPlayer) {
    return (
      <PlayerSelectScreen
        onSelected={() => {
          if (state.isAdmin && rounds.length === 0) setOverlayScreen('setup-choice')
        }}
        onBack={() => {
          actions.clearSession()
          setShowNewGame(false)
        }}
      />
    )
  }

  // Data loading
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

  // ── Overlay screens ──────────────────────────────────────────────────────

  if (overlayScreen === 'setup-choice') {
    return (
      <div className="min-h-screen bg-gray-900 flex flex-col items-center justify-center p-6 max-w-md mx-auto gap-4">
        <h2 className="text-xl font-bold text-white text-center">How would you like to set up?</h2>
        <p className="text-sm text-gray-500 text-center -mt-2">You can always add more rounds later</p>

        <button
          onClick={() => setOverlayScreen('trip-setup')}
          className="w-full bg-gray-800 border-2 border-green-600 rounded-2xl p-5 text-left hover:border-green-500 transition-colors"
        >
          <div className="text-lg font-bold text-white mb-1">🗓 Plan Full Trip</div>
          <div className="text-sm text-gray-400">Set up all rounds at once — dates, courses, groups, and wolf order for the whole trip. Rounds stay pending until you start them.</div>
        </button>

        <button
          onClick={() => setOverlayScreen('setup')}
          className="w-full bg-gray-800 border-2 border-gray-700 rounded-2xl p-5 text-left hover:border-gray-600 transition-colors"
        >
          <div className="text-lg font-bold text-white mb-1">⛳ Quick Single Round</div>
          <div className="text-sm text-gray-400">Set up one round right now and start scoring. Add more rounds later from the admin toolbar.</div>
        </button>

        <button onClick={() => setOverlayScreen(null)} className="text-gray-600 text-sm py-2">
          Cancel
        </button>
      </div>
    )
  }

  if (overlayScreen === 'players') {
    return (
      <PlayersModal
        players={state.players}
        onClose={() => setOverlayScreen(null)}
        onUpdate={actions.reloadPlayers}
      />
    )
  }

  if (overlayScreen === 'trip-setup') {
    return (
      <TripSetupScreen
        onDone={() => setOverlayScreen(null)}
        onBack={() => setOverlayScreen(null)}
      />
    )
  }

  if (overlayScreen === 'setup') {
    return <AdminSetupScreen onDone={() => setOverlayScreen(null)} onBack={() => setOverlayScreen(null)} />
  }

  if (overlayScreen === 'scan') {
    return <CourseScanScreen onBack={() => setOverlayScreen(null)} onSaved={() => setOverlayScreen(null)} />
  }

  if (overlayScreen === 'round-hub') {
    return (
      <RoundHub
        rounds={sortedRounds}
        courses={state.courses}
        activeRoundId={activeRoundId}
        isAdmin={isAdmin}
        startingRound={startingRound}
        deletingRound={deletingRound}
        onStartRound={handleStartRound}
        onDeleteRound={handleDeleteRound}
        onClose={() => setOverlayScreen(null)}
      />
    )
  }

  // ── Main app ─────────────────────────────────────────────────────────────

  const adminBarRows = isAdmin ? (rounds.length > 1 ? 2 : 1) : 0
  const adminBarPad = adminBarRows === 2 ? 'pt-14' : adminBarRows === 1 ? 'pt-9' : ''

  return (
    <div className="relative">
      {/* Admin toolbar */}
      {isAdmin && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-yellow-50 border-b border-yellow-200 max-w-md mx-auto text-xs">
          <div className="flex items-center px-4 py-1.5 gap-2">
            <span className="font-semibold text-yellow-800">Admin</span>
            <span className="text-yellow-600 truncate">
              Code: <span className="font-mono font-bold tracking-widest">{state.joinCode}</span>
            </span>
            <div className="flex-1" />
            {/* Trip setup or add single round */}
            {rounds.length === 0 ? (
              <button
                onClick={() => setOverlayScreen('setup-choice')}
                className="bg-green-600 text-white px-2 py-1 rounded font-medium whitespace-nowrap"
              >
                Setup
              </button>
            ) : (
              <>
                <button
                  onClick={() => setOverlayScreen('round-hub')}
                  className="bg-yellow-100 text-yellow-800 px-2 py-1 rounded font-medium whitespace-nowrap relative"
                >
                  Rounds
                  {hasPendingRounds && (
                    <span className="absolute -top-1 -right-1 w-4 h-4 bg-green-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
                      {pendingRounds.length}
                    </span>
                  )}
                </button>
                <button
                  onClick={() => setOverlayScreen('setup')}
                  className="bg-yellow-100 text-yellow-800 px-2 py-1 rounded font-medium whitespace-nowrap"
                >
                  + Round
                </button>
              </>
            )}
            <button
              onClick={() => setOverlayScreen('players')}
              className="bg-yellow-100 text-yellow-800 px-2 py-1 rounded font-medium whitespace-nowrap"
            >
              Players
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
              {completing ? '…' : 'End'}
            </button>
          </div>

          {/* Active round switcher row */}
          {rounds.length > 1 && (
            <div className="flex items-center gap-1.5 px-4 pb-1.5 overflow-x-auto no-scrollbar">
              <span className="text-yellow-600 shrink-0 font-medium">Scoring:</span>
              {sortedRounds.map((r) => (
                <button
                  key={r.id}
                  onClick={() => actions.setActiveRound(r.id)}
                  className={`shrink-0 px-2 py-0.5 rounded text-[11px] font-semibold transition-colors
                    ${r.id === activeRoundId
                      ? 'bg-yellow-600 text-white'
                      : r.status === 'pending'
                        ? 'bg-yellow-100 text-yellow-500 border border-yellow-300'
                        : 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200'}`}
                >
                  R{r.round_number}
                  {r.status === 'pending' && <span className="ml-0.5 opacity-60">⋯</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* No rounds yet — non-admin waiting */}
      {!isAdmin && rounds.length === 0 && (
        <div className="fixed inset-0 flex items-center justify-center bg-gray-900 z-40 p-8">
          <div className="text-center">
            <div className="text-4xl mb-4">⏳</div>
            <h2 className="font-semibold text-white mb-2">Waiting for admin to set up the trip</h2>
            <p className="text-sm text-gray-500">Ask the trip admin to complete trip setup.</p>
          </div>
        </div>
      )}

      {/* Next round is pending — show start prompt */}
      {!hasActiveRound && rounds.length > 0 && (
        <div className="fixed inset-0 bg-gray-900 z-40 flex flex-col items-center justify-center p-6 max-w-md mx-auto">
          <RoundHub
            rounds={sortedRounds}
            courses={state.courses}
            activeRoundId={activeRoundId}
            isAdmin={isAdmin}
            startingRound={startingRound}
            deletingRound={deletingRound}
            onStartRound={handleStartRound}
            onDeleteRound={handleDeleteRound}
            onClose={null}
            embedded
          />
        </div>
      )}

      {/* "Start next round" banner when active round exists but next pending round is ready */}
      {hasActiveRound && nextPendingRound && isAdmin && (
        <div className={`fixed left-0 right-0 z-30 max-w-md mx-auto ${adminBarPad}`}>
          <button
            onClick={() => setOverlayScreen('round-hub')}
            className="w-full bg-green-700 text-white text-xs font-semibold py-2 flex items-center justify-center gap-2"
          >
            <span className="text-green-300">●</span>
            Round {nextPendingRound.round_number} ready to start
            <span className="text-green-300">›</span>
          </button>
        </div>
      )}

      {/* Main screens */}
      <div className={`${adminBarPad} ${hasActiveRound && nextPendingRound && isAdmin ? 'mt-7' : ''}`}>
        {mainScreen === 'score' && <ScoringScreen setScreen={setMainScreen} />}
        {mainScreen === 'leaderboard' && <LeaderboardScreen setScreen={setMainScreen} />}
        {mainScreen === 'settlement' && <SettlementScreen setScreen={setMainScreen} />}
      </div>
    </div>
  )
}

// ── Round Hub ─────────────────────────────────────────────────────────────

function RoundHub({ rounds, courses, activeRoundId, isAdmin, startingRound, deletingRound, onStartRound, onDeleteRound, onClose, embedded }) {
  // Group rounds by date
  const days = []
  const dateMap = new Map()
  for (const r of rounds) {
    const key = r.date || `_r${r.round_number}`
    if (!dateMap.has(key)) {
      dateMap.set(key, { date: r.date, rounds: [], dayNum: dateMap.size + 1 })
      days.push(dateMap.get(key))
    }
    dateMap.get(key).rounds.push(r)
  }

  function formatDate(d) {
    if (!d) return ''
    const dt = new Date(d + 'T12:00:00')
    return dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  }

  function statusBadge(r) {
    if (r.id === activeRoundId && r.status !== 'pending') {
      return <span className="text-xs font-semibold text-green-400 flex items-center gap-1"><span className="text-green-500">●</span> Active</span>
    }
    if (r.status === 'pending') {
      return <span className="text-xs text-gray-500">Pending</span>
    }
    if (r.status === 'complete') {
      return <span className="text-xs text-gray-500">✓ Done</span>
    }
    return <span className="text-xs text-gray-500">{r.status}</span>
  }

  const content = (
    <div className={`${embedded ? 'w-full max-w-sm' : 'min-h-screen bg-gray-900 max-w-md mx-auto'} flex flex-col`}>
      {!embedded && (
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
          <h2 className="text-base font-semibold text-white">Round Hub</h2>
          {onClose && (
            <button onClick={onClose} className="text-gray-500 text-2xl leading-none">×</button>
          )}
        </div>
      )}
      {embedded && (
        <div className="text-center mb-6">
          <div className="text-4xl mb-3">⛳</div>
          <h2 className="text-xl font-bold text-white">Round Hub</h2>
          <p className="text-sm text-gray-500 mt-1">Tap Start to begin the next round</p>
        </div>
      )}

      <div className={`${embedded ? '' : 'p-4'} flex-1 space-y-4`}>
        {days.map((day) => (
          <div key={day.dayNum}>
            {day.date ? (
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 px-1">
                Day {day.dayNum} — {formatDate(day.date)}
              </p>
            ) : (
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 px-1">
                Day {day.dayNum}
              </p>
            )}
            <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden divide-y divide-gray-700">
              {day.rounds.map((r) => {
                const course = courses.find((c) => c.round_number === r.round_number)
                const isPending = r.status === 'pending'
                const isStarting = startingRound === r.id

                return (
                  <div key={r.id} className="px-4 py-3 flex items-center gap-3">
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center text-sm font-bold shrink-0
                      ${r.id === activeRoundId && !isPending ? 'bg-green-700 text-white' : 'bg-gray-700 text-gray-400'}`}>
                      R{r.round_number}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-white truncate">
                        {course?.name || `Round ${r.round_number}`}
                      </div>
                      <div className="mt-0.5">{statusBadge(r)}</div>
                    </div>
                    {isPending && isAdmin && (
                      <button
                        onClick={() => onStartRound(r.id)}
                        disabled={!!startingRound || !!deletingRound}
                        className="shrink-0 bg-green-600 text-white px-3 py-1.5 rounded-lg text-sm font-semibold disabled:opacity-50 flex items-center gap-1.5"
                      >
                        {isStarting ? <Spinner size="sm" /> : '▶ Start'}
                      </button>
                    )}
                    {isPending && !isAdmin && (
                      <span className="text-xs text-gray-600 shrink-0">Waiting…</span>
                    )}
                    {isAdmin && (
                      <button
                        onClick={() => onDeleteRound(r.id)}
                        disabled={!!deletingRound || !!startingRound}
                        className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-gray-600 hover:text-red-400 hover:bg-red-900/20 transition-colors disabled:opacity-30"
                        title="Delete round"
                      >
                        {deletingRound === r.id ? <Spinner size="sm" /> : '🗑'}
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {!embedded && onClose && (
        <div className="p-4 border-t border-gray-800">
          <button
            onClick={onClose}
            className="w-full bg-gray-800 text-gray-300 py-3 rounded-xl font-medium"
          >
            Close
          </button>
        </div>
      )}
    </div>
  )

  if (embedded) return content
  return <div className="min-h-screen bg-gray-900">{content}</div>
}

// ── Players & Handicaps modal ─────────────────────────────────────────────

function PlayersModal({ players, onClose, onUpdate }) {
  const [handicaps, setHandicaps] = useState(
    () => Object.fromEntries(players.map((p) => [p.id, p.handicap ?? 0]))
  )
  const [saving, setSaving] = useState(null)

  async function adjust(playerId, delta) {
    const next = Math.max(0, Math.min(54, (handicaps[playerId] ?? 0) + delta))
    setHandicaps((prev) => ({ ...prev, [playerId]: next }))
    setSaving(playerId)
    try {
      await updatePlayerHandicap(playerId, next)
      await onUpdate()
    } finally {
      setSaving(null)
    }
  }

  return (
    <div className="min-h-screen bg-gray-900 max-w-md mx-auto flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 sticky top-0 bg-gray-900 z-10">
        <h2 className="text-base font-semibold text-white">Players &amp; Handicaps</h2>
        <button onClick={onClose} className="text-gray-400 text-2xl leading-none px-1">×</button>
      </div>

      <div className="flex-1 p-4 space-y-2">
        <p className="text-xs text-gray-500 pb-1">Changes apply immediately to all net score calculations.</p>
        {players.map((p) => {
          const hdcp = handicaps[p.id] ?? p.handicap ?? 0
          return (
            <div key={p.id} className="bg-gray-800 rounded-xl border border-gray-700 px-4 py-3 flex items-center gap-3">
              <div className="flex-1">
                <div className="font-semibold text-sm text-white">{p.name}</div>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => adjust(p.id, -1)}
                  disabled={hdcp <= 0 || saving === p.id}
                  className="w-9 h-9 rounded-full bg-gray-700 text-gray-300 font-bold text-lg flex items-center justify-center disabled:opacity-30"
                >
                  −
                </button>
                <span className="w-8 text-center font-bold text-white text-lg tabular-nums">
                  {hdcp}
                </span>
                <button
                  onClick={() => adjust(p.id, 1)}
                  disabled={hdcp >= 54 || saving === p.id}
                  className="w-9 h-9 rounded-full bg-gray-700 text-gray-300 font-bold text-lg flex items-center justify-center disabled:opacity-30"
                >
                  +
                </button>
                {saving === p.id && <Spinner size="sm" />}
              </div>
            </div>
          )
        })}
      </div>

      <div className="p-4 border-t border-gray-800">
        <button
          onClick={onClose}
          className="w-full bg-green-600 text-white py-3 rounded-xl font-semibold"
        >
          Done
        </button>
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

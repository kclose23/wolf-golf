import { useState, useEffect } from 'react'
import { useApp } from '../context/AppContext'
import { getTripsForUser, deleteTrip } from '../lib/db'
import Spinner from '../components/Spinner'

export default function HistoryScreen({ onNewGame }) {
  const { state, actions } = useApp()
  const { user } = state
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [rejoining, setRejoining] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!user) return
    getTripsForUser(user.id)
      .then(setHistory)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [user])

  async function handleDelete(tripId, tripName) {
    if (!confirm(`Delete "${tripName}" and all its data? This cannot be undone.`)) return
    setDeleting(tripId)
    setError('')
    try {
      await deleteTrip(tripId)
      setHistory((prev) => prev.filter((r) => r.trip.id !== tripId))
    } catch (err) {
      setError(err.message)
    } finally {
      setDeleting(null)
    }
  }

  async function handleRejoin(record) {
    setRejoining(record.trip.id)
    setError('')
    try {
      await actions.joinTrip(record.trip.join_code)
      actions.setPlayerId(record.id)
    } catch (err) {
      setError(err.message)
    } finally {
      setRejoining(null)
    }
  }

  const groupedByTrip = history.reduce((acc, record) => {
    if (!acc[record.trip.id]) acc[record.trip.id] = { trip: record.trip, players: [] }
    acc[record.trip.id].players.push(record)
    return acc
  }, {})
  const trips = Object.values(groupedByTrip).sort(
    (a, b) => new Date(b.trip.created_at) - new Date(a.trip.created_at)
  )

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col max-w-md mx-auto">
      <header className="bg-gray-900 border-b border-gray-800 px-4 py-4 sticky top-0 z-40 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-white">Wolf Golf</h1>
          <p className="text-xs text-gray-500">{user?.email}</p>
        </div>
        <button
          onClick={() => actions.signOut()}
          className="text-xs text-gray-500 px-3 py-1.5 border border-gray-700 rounded-lg"
        >
          Sign Out
        </button>
      </header>

      <div className="flex-1 p-4 space-y-4 pb-8">
        <button
          onClick={onNewGame}
          className="w-full bg-green-600 text-white py-4 rounded-2xl font-bold text-base flex items-center justify-center gap-2 shadow-lg shadow-green-900/30"
        >
          <span className="text-xl">⛳</span>
          Join or Start a New Game
        </button>

        {error && <p className="text-red-400 text-sm text-center">{error}</p>}

        {loading ? (
          <div className="flex justify-center py-12">
            <Spinner size="lg" />
          </div>
        ) : trips.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-4xl mb-3">📋</div>
            <p className="font-semibold text-white">No trips yet</p>
            <p className="text-sm text-gray-500 mt-1">Start or join a game above.</p>
          </div>
        ) : (
          <>
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-widest">Past Trips</h2>
            <div className="space-y-3">
              {trips.map(({ trip, players }) => {
                const date = trip.created_at
                  ? new Date(trip.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                  : ''
                const myPlayer = players[0]
                const isComplete = trip.status === 'complete'
                return (
                  <div key={trip.id} className={`bg-gray-800 rounded-2xl border overflow-hidden ${isComplete ? 'border-gray-700' : 'border-gray-700'}`}>
                    <div className="px-4 py-3.5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="font-bold text-white truncate">{trip.name}</span>
                            {isComplete && (
                              <span className="shrink-0 text-xs bg-gray-700 text-gray-400 px-2 py-0.5 rounded-full font-medium">
                                Complete
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-gray-500">
                            {date} · <span className="font-mono font-bold tracking-widest text-gray-400">{trip.join_code}</span>
                          </div>
                          <div className="text-xs text-gray-400 mt-0.5">
                            As <span className="font-semibold text-gray-300">{myPlayer.name}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            onClick={() => handleRejoin(myPlayer)}
                            disabled={rejoining === trip.id || deleting === trip.id}
                            className="bg-green-600 text-white px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-50 flex items-center gap-1"
                          >
                            {rejoining === trip.id ? <Spinner size="sm" /> : 'Rejoin'}
                          </button>
                          <button
                            onClick={() => handleDelete(trip.id, trip.name)}
                            disabled={deleting === trip.id || rejoining === trip.id}
                            className="w-9 h-9 flex items-center justify-center rounded-xl border border-gray-700 text-gray-500 hover:text-red-400 hover:border-red-800 hover:bg-red-900/20 transition-colors disabled:opacity-30"
                            title="Delete trip"
                          >
                            {deleting === trip.id ? <Spinner size="sm" /> : '🗑'}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

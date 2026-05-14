import { useState } from 'react'
import { useApp } from '../context/AppContext'
import { createTrip, createPlayer } from '../lib/db'
import Spinner from '../components/Spinner'

function generateCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase()
}

export default function HomeScreen({ onJoined }) {
  const { actions } = useApp()
  const [mode, setMode] = useState('join') // 'join' | 'create'
  const [joinCode, setJoinCode] = useState('')
  const [tripName, setTripName] = useState('')
  const [adminName, setAdminName] = useState('')
  const [dollarPerPoint, setDollarPerPoint] = useState('1')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleJoin(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await actions.joinTrip(joinCode.trim())
      onJoined()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleCreate(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const code = generateCode()
      const trip = await createTrip({
        name: tripName.trim() || 'Golf Trip',
        joinCode: code,
        dollarPerPoint: parseFloat(dollarPerPoint) || 1,
      })
      const player = await createPlayer({ tripId: trip.id, name: adminName.trim(), handicap: 0, isAdmin: true })
      actions.setTrip(trip)
      actions.setPlayerId(player.id)
      await actions.reload()
      onJoined({ isAdmin: true, newTrip: true })
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center p-6 max-w-md mx-auto">
      <div className="text-6xl mb-4">⛳</div>
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Wolf Golf</h1>
      <p className="text-gray-500 text-sm mb-8">Golf trip score tracker</p>

      {/* Mode toggle */}
      <div className="flex rounded-lg bg-gray-100 p-1 w-full mb-6">
        <button
          onClick={() => setMode('join')}
          className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors
            ${mode === 'join' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}
        >
          Join Trip
        </button>
        <button
          onClick={() => setMode('create')}
          className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors
            ${mode === 'create' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}
        >
          Create Trip
        </button>
      </div>

      {mode === 'join' ? (
        <form onSubmit={handleJoin} className="w-full space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Join Code</label>
            <input
              type="text"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              placeholder="ABC123"
              maxLength={6}
              className="w-full border border-gray-300 rounded-lg px-4 py-3 text-center text-2xl font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-green-500 uppercase"
              autoCapitalize="characters"
              autoCorrect="off"
            />
          </div>
          {error && <p className="text-red-500 text-sm text-center">{error}</p>}
          <button
            type="submit"
            disabled={joinCode.length < 6 || loading}
            className="w-full bg-green-600 text-white py-3 rounded-lg font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? <Spinner size="sm" /> : 'Join Trip'}
          </button>
        </form>
      ) : (
        <form onSubmit={handleCreate} className="w-full space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Trip Name</label>
            <input
              type="text"
              value={tripName}
              onChange={(e) => setTripName(e.target.value)}
              placeholder="Pebble Beach 2026"
              className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Your Name</label>
            <input
              type="text"
              value={adminName}
              onChange={(e) => setAdminName(e.target.value)}
              placeholder="Your name"
              className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">$ Per Point</label>
            <input
              type="number"
              value={dollarPerPoint}
              onChange={(e) => setDollarPerPoint(e.target.value)}
              min="0.25"
              step="0.25"
              className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>
          {error && <p className="text-red-500 text-sm text-center">{error}</p>}
          <button
            type="submit"
            disabled={!adminName.trim() || loading}
            className="w-full bg-green-600 text-white py-3 rounded-lg font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? <Spinner size="sm" /> : 'Create Trip'}
          </button>
          <p className="text-xs text-gray-400 text-center">
            A join code will be generated to share with your group.
          </p>
        </form>
      )}
    </div>
  )
}

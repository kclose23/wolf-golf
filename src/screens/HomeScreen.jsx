import { useState, useMemo } from 'react'
import { useApp } from '../context/AppContext'
import { createTrip, createPlayer } from '../lib/db'
import { calcPot } from '../lib/gameEngine'
import Spinner from '../components/Spinner'

function generateCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase()
}

export default function HomeScreen({ onJoined, onBack }) {
  const { state, actions } = useApp()
  const { user } = state
  const [mode, setMode] = useState('join')
  const [joinCode, setJoinCode] = useState('')
  const [tripName, setTripName] = useState('')
  const [adminName, setAdminName] = useState('')
  const [buyIn, setBuyIn] = useState('')
  const [playerCount, setPlayerCount] = useState('8')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Live pot breakdown
  const pot = useMemo(() => {
    const b = parseFloat(buyIn) || 0
    const n = parseInt(playerCount) || 8
    if (!b) return null
    return calcPot(b, n)
  }, [buyIn, playerCount])

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
      const b = parseFloat(buyIn) || 0
      const n = parseInt(playerCount) || 8
      const trip = await createTrip({
        name: tripName.trim() || 'Golf Trip',
        joinCode: code,
        dollarPerPoint: 1,
        buyIn: b,
      })
      const player = await createPlayer({ tripId: trip.id, name: adminName.trim(), handicap: 0, userId: user?.id, isAdmin: true })
      actions.setTrip(trip)
      actions.setPlayerId(player.id)
      actions.setAdmin(true)
      await actions.reload()
      onJoined({ isAdmin: true, newTrip: true })
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col items-center justify-center p-6 max-w-md mx-auto">
      {onBack && (
        <button onClick={onBack} className="self-start text-sm text-gray-500 flex items-center gap-1 mb-6">
          ← Back
        </button>
      )}

      <img src="/logo.svg" alt="Wolf Golf" className="w-24 h-24 mb-4 rounded-2xl" />
      <h1 className="text-3xl font-bold text-white mb-1">Wolf Golf</h1>
      <p className="text-gray-500 text-sm mb-8">Golf trip score tracker</p>

      <div className="flex rounded-xl bg-gray-800 p-1 w-full mb-6">
        <button
          onClick={() => setMode('join')}
          className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-colors
            ${mode === 'join' ? 'bg-gray-700 text-white shadow' : 'text-gray-500'}`}
        >
          Join Trip
        </button>
        <button
          onClick={() => setMode('create')}
          className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-colors
            ${mode === 'create' ? 'bg-gray-700 text-white shadow' : 'text-gray-500'}`}
        >
          Create Trip
        </button>
      </div>

      {mode === 'join' ? (
        <form onSubmit={handleJoin} className="w-full space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1.5">Join Code</label>
            <input
              type="text"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              placeholder="ABC123"
              maxLength={6}
              className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-4 text-center text-3xl font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-green-500 placeholder-gray-700 uppercase"
              autoCapitalize="characters"
              autoCorrect="off"
            />
          </div>
          {error && <p className="text-red-400 text-sm text-center">{error}</p>}
          <button
            type="submit"
            disabled={joinCode.length < 6 || loading}
            className="w-full bg-green-600 text-white py-3.5 rounded-xl font-bold disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? <Spinner size="sm" /> : 'Join Trip'}
          </button>
        </form>
      ) : (
        <form onSubmit={handleCreate} className="w-full space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1.5">Trip Name</label>
            <input
              type="text"
              value={tripName}
              onChange={(e) => setTripName(e.target.value)}
              placeholder="Pebble Beach 2026"
              className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-green-500 placeholder-gray-600"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1.5">Your Name</label>
            <input
              type="text"
              value={adminName}
              onChange={(e) => setAdminName(e.target.value)}
              placeholder="Your name"
              className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-green-500 placeholder-gray-600"
            />
          </div>

          {/* Buy-in + player count */}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-400 mb-1.5">Buy-in per person ($)</label>
              <input
                type="number"
                value={buyIn}
                onChange={(e) => setBuyIn(e.target.value)}
                placeholder="100"
                min="0"
                step="5"
                className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-green-500 placeholder-gray-600"
              />
            </div>
            <div className="w-24">
              <label className="block text-sm font-medium text-gray-400 mb-1.5">Players</label>
              <input
                type="number"
                value={playerCount}
                onChange={(e) => setPlayerCount(e.target.value)}
                min="2"
                max="20"
                className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 text-center focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
          </div>

          {/* Live pot breakdown */}
          {pot && (
            <div className="bg-gray-800 rounded-xl border border-gray-700 p-4 space-y-2">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Pot Breakdown</p>
              <div className="text-xs text-gray-500 space-y-1.5">
                <div className="flex justify-between">
                  <span>Total pot ({parseInt(playerCount)} × ${parseFloat(buyIn).toFixed(0)})</span>
                  <span className="font-bold text-white">${pot.total.toFixed(0)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Trip Net Champion (43.75%)</span>
                  <span className="text-green-400 font-semibold">${pot.tripChampion.toFixed(0)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Daily Net — per day × 3 (11.25%)</span>
                  <span className="text-blue-400 font-semibold">${pot.dailyNet.toFixed(0)}/day</span>
                </div>
                <div className="flex justify-between">
                  <span>Skins — per day × 3 (7.5%)</span>
                  <span className="text-orange-400 font-semibold">${pot.skinsDay.toFixed(0)}/day</span>
                </div>
                <div className="flex justify-between border-t border-gray-700 pt-1.5 mt-1">
                  <span className="text-gray-600">Wolf</span>
                  <span className="text-gray-500">$1/pt between groups (separate)</span>
                </div>
              </div>
            </div>
          )}

          {error && <p className="text-red-400 text-sm text-center">{error}</p>}
          <button
            type="submit"
            disabled={!adminName.trim() || loading}
            className="w-full bg-green-600 text-white py-3.5 rounded-xl font-bold disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? <Spinner size="sm" /> : 'Create Trip'}
          </button>
          <p className="text-xs text-gray-600 text-center">
            A join code will be generated to share with your group.
          </p>
        </form>
      )}
    </div>
  )
}

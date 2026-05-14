import { useState } from 'react'
import { useApp } from '../context/AppContext'
import { createPlayer, updatePlayerHandicap } from '../lib/db'
import Layout from '../components/Layout'
import Spinner from '../components/Spinner'

export default function PlayerSelectScreen({ onSelected }) {
  const { state, actions } = useApp()
  const { players, tripId } = state
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newHandicap, setNewHandicap] = useState('0')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSelect(player) {
    actions.setPlayerId(player.id)
    onSelected(player)
  }

  async function handleAdd(e) {
    e.preventDefault()
    if (!newName.trim()) return
    setLoading(true)
    setError('')
    try {
      const player = await createPlayer({
        tripId,
        name: newName.trim(),
        handicap: parseInt(newHandicap) || 0,
      })
      await actions.reload()
      actions.setPlayerId(player.id)
      onSelected(player)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Layout title="Who Are You?">
      <div className="space-y-3">
        <p className="text-sm text-gray-500 mb-4">
          Pick your name from the roster, or add yourself if you're not listed yet.
        </p>

        {players.length > 0 && (
          <div className="space-y-2">
            {players.map((p) => (
              <button
                key={p.id}
                onClick={() => handleSelect(p)}
                className="w-full flex items-center justify-between bg-white border border-gray-200 rounded-xl px-4 py-4 text-left hover:border-green-400 transition-colors"
              >
                <div>
                  <div className="font-semibold text-gray-900">{p.name}</div>
                  <div className="text-xs text-gray-400">Handicap: {p.handicap ?? 0}</div>
                </div>
                <span className="text-green-600 text-lg">→</span>
              </button>
            ))}
          </div>
        )}

        <div className="border-t border-gray-100 pt-4 mt-4">
          {!adding ? (
            <button
              onClick={() => setAdding(true)}
              className="w-full border-2 border-dashed border-gray-200 rounded-xl py-4 text-sm text-gray-400 hover:border-green-400 hover:text-green-600 transition-colors"
            >
              + Add my name
            </button>
          ) : (
            <form onSubmit={handleAdd} className="space-y-3">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Your name"
                className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-green-500"
                autoFocus
              />
              <div className="flex gap-2 items-center">
                <label className="text-sm text-gray-600 whitespace-nowrap">Handicap:</label>
                <input
                  type="number"
                  value={newHandicap}
                  onChange={(e) => setNewHandicap(e.target.value)}
                  min="0"
                  max="54"
                  className="w-20 border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>
              {error && <p className="text-red-500 text-sm">{error}</p>}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setAdding(false)}
                  className="flex-1 border border-gray-200 rounded-lg py-3 text-sm font-medium text-gray-600"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!newName.trim() || loading}
                  className="flex-1 bg-green-600 text-white rounded-lg py-3 text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {loading ? <Spinner size="sm" /> : 'Join'}
                </button>
              </div>
            </form>
          )}
        </div>

        <div className="pt-4 border-t border-gray-100">
          <p className="text-xs text-gray-400 text-center">
            Join code: <span className="font-mono font-bold tracking-widest">{state.joinCode}</span>
          </p>
          <p className="text-xs text-gray-400 text-center mt-1">Share this with your group</p>
        </div>
      </div>
    </Layout>
  )
}

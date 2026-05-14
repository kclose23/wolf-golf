import { useState } from 'react'
import { useApp } from '../context/AppContext'
import { createOrUpdateRound, saveGroupings, createPlayer } from '../lib/db'
import Layout from '../components/Layout'
import Spinner from '../components/Spinner'

const GROUP_COLORS = [
  { bg: 'bg-green-50', text: 'text-green-800', btn: 'text-green-600' },
  { bg: 'bg-blue-50',  text: 'text-blue-800',  btn: 'text-blue-600'  },
  { bg: 'bg-purple-50', text: 'text-purple-800', btn: 'text-purple-600' },
  { bg: 'bg-orange-50', text: 'text-orange-800', btn: 'text-orange-600' },
]

export default function AdminSetupScreen({ onDone, onBack }) {
  const { state, actions } = useApp()
  const { players, rounds, tripId } = state

  const [step, setStep] = useState('round') // 'round' | 'groups' | 'wolforder'
  const [roundNumber, setRoundNumber] = useState(
    rounds.length > 0 ? rounds.length + 1 : 1
  )
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])

  // Dynamic groups: array of arrays of player ids
  const [groups, setGroups] = useState([[]])
  const [wolfOrder, setWolfOrder] = useState([[]])

  // Inline player creation
  const [newName, setNewName] = useState('')
  const [newHandicap, setNewHandicap] = useState('0')
  const [addingPlayer, setAddingPlayer] = useState(false)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const unassigned = players.filter((p) => !groups.some((g) => g.includes(p.id)))

  function assignPlayer(playerId, groupIdx) {
    setGroups((prev) => {
      const next = prev.map((g) => g.filter((id) => id !== playerId))
      if (groupIdx >= 0) next[groupIdx] = [...next[groupIdx], playerId].slice(0, 4)
      return next
    })
    setWolfOrder((prev) => prev.map((g) => g.filter((id) => id !== playerId)))
  }

  function addGroup() {
    setGroups((prev) => [...prev, []])
    setWolfOrder((prev) => [...prev, []])
  }

  function removeGroup(gi) {
    setGroups((prev) => {
      const next = prev.filter((_, i) => i !== gi)
      return next.length ? next : [[]]
    })
    setWolfOrder((prev) => {
      const next = prev.filter((_, i) => i !== gi)
      return next.length ? next : [[]]
    })
  }

  function moveWolf(groupIdx, fromIdx, toIdx) {
    setWolfOrder((prev) => {
      const next = [...prev]
      const arr = [...next[groupIdx]]
      const [moved] = arr.splice(fromIdx, 1)
      arr.splice(toIdx, 0, moved)
      next[groupIdx] = arr
      return next
    })
  }

  function shuffleWolf(groupIdx) {
    setWolfOrder((prev) => {
      const next = [...prev]
      const arr = [...next[groupIdx]]
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[arr[i], arr[j]] = [arr[j], arr[i]]
      }
      next[groupIdx] = arr
      return next
    })
  }

  function initWolfOrder() {
    setWolfOrder(groups.map((g) => [...g]))
  }

  async function handleAddPlayer(e) {
    e.preventDefault()
    if (!newName.trim()) return
    setAddingPlayer(true)
    setError('')
    try {
      await createPlayer({ tripId, name: newName.trim(), handicap: parseInt(newHandicap) || 0 })
      setNewName('')
      setNewHandicap('0')
      await actions.reloadPlayers()
    } catch (err) {
      setError(err.message)
    } finally {
      setAddingPlayer(false)
    }
  }

  async function handleSave() {
    setLoading(true)
    setError('')
    try {
      const round = await createOrUpdateRound({ tripId, roundNumber, date, status: 'active' })

      const groupingRows = []
      for (let gi = 0; gi < groups.length; gi++) {
        const groupNum = gi + 1
        const order = wolfOrder[gi].length > 0 ? wolfOrder[gi] : groups[gi]
        order.forEach((playerId, idx) => {
          groupingRows.push({ playerId, groupNumber: groupNum, wolfOrder: idx + 1 })
        })
      }

      await saveGroupings(round.id, groupingRows)
      actions.setActiveRound(round.id)
      await actions.reload()
      onDone()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  // ── Round step ─────────────────────────────────────────────────────────────

  if (step === 'round') {
    return (
      <Layout title="Setup Round" onBack={onBack}>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Round Number</label>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setRoundNumber((n) => Math.max(1, n - 1))}
                disabled={roundNumber <= 1}
                className="w-10 h-10 rounded-lg border-2 border-gray-200 text-gray-600 font-bold text-xl disabled:opacity-30 flex items-center justify-center"
              >
                −
              </button>
              <div className="flex-1 text-center py-2.5 rounded-lg border-2 border-green-600 bg-green-50 text-green-700 font-semibold text-lg">
                Round {roundNumber}
              </div>
              <button
                onClick={() => setRoundNumber((n) => n + 1)}
                className="w-10 h-10 rounded-lg border-2 border-gray-200 text-gray-600 font-bold text-xl flex items-center justify-center"
              >
                +
              </button>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>
          <button
            onClick={() => setStep('groups')}
            className="w-full bg-green-600 text-white py-3 rounded-lg font-semibold"
          >
            Next: Set Groups →
          </button>
        </div>
      </Layout>
    )
  }

  // ── Groups step ────────────────────────────────────────────────────────────

  if (step === 'groups') {
    const groupsFull = groups.length > 0 && groups.every((g) => g.length >= 2)

    return (
      <Layout title="Assign Groups" onBack={() => setStep('round')}>
        <div className="space-y-4">

          {/* Add player inline */}
          <form onSubmit={handleAddPlayer} className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Add Player to Trip</p>
            <div className="flex gap-2">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Name"
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
              <input
                type="number"
                value={newHandicap}
                onChange={(e) => setNewHandicap(e.target.value)}
                placeholder="Hdcp"
                min="0"
                max="54"
                className="w-16 border border-gray-300 rounded-lg px-3 py-2 text-sm text-center focus:outline-none focus:ring-2 focus:ring-green-500"
              />
              <button
                type="submit"
                disabled={!newName.trim() || addingPlayer}
                className="bg-green-600 text-white px-3 py-2 rounded-lg text-sm font-semibold disabled:opacity-50 flex items-center gap-1"
              >
                {addingPlayer ? <Spinner size="sm" /> : '+ Add'}
              </button>
            </div>
          </form>

          {/* Unassigned players */}
          {unassigned.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
                Unassigned ({unassigned.length}) — tap a group number to assign
              </p>
              <div className="flex flex-wrap gap-2">
                {unassigned.map((p) => (
                  <div key={p.id} className="bg-gray-100 rounded-full px-3 py-1.5 text-sm flex items-center gap-1.5">
                    <span className="font-medium">{p.name}</span>
                    <span className="text-gray-400">→</span>
                    {groups.map((_, gi) => {
                      const c = GROUP_COLORS[gi % GROUP_COLORS.length]
                      return (
                        <button
                          key={gi}
                          onClick={() => assignPlayer(p.id, gi)}
                          disabled={groups[gi].length >= 4}
                          className={`${c.btn} font-bold disabled:opacity-30`}
                        >
                          G{gi + 1}
                        </button>
                      )
                    })}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Group cards */}
          {groups.map((group, gi) => {
            const c = GROUP_COLORS[gi % GROUP_COLORS.length]
            return (
              <div key={gi} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className={`px-4 py-2 flex items-center justify-between text-sm font-semibold ${c.bg} ${c.text}`}>
                  <span>Group {gi + 1} ({group.length}/4)</span>
                  {groups.length > 1 && group.length === 0 && (
                    <button onClick={() => removeGroup(gi)} className="text-xs text-red-400 font-medium">Remove</button>
                  )}
                </div>
                <div className="divide-y divide-gray-100">
                  {group.map((pid) => {
                    const p = players.find((pl) => pl.id === pid)
                    return (
                      <div key={pid} className="flex items-center justify-between px-4 py-3">
                        <div>
                          <span className="text-sm font-medium">{p?.name}</span>
                          <span className="text-xs text-gray-400 ml-2">Hdcp {p?.handicap ?? 0}</span>
                        </div>
                        <button onClick={() => assignPlayer(pid, -1)} className="text-red-400 text-xs">Remove</button>
                      </div>
                    )
                  })}
                  {group.length === 0 && (
                    <p className="px-4 py-3 text-sm text-gray-400 italic">Empty</p>
                  )}
                </div>
              </div>
            )
          })}

          {/* Add group */}
          <button
            onClick={addGroup}
            className="w-full border-2 border-dashed border-gray-300 text-gray-500 py-2.5 rounded-xl text-sm font-medium hover:border-gray-400 transition-colors"
          >
            + Add Group
          </button>

          {error && <p className="text-red-500 text-sm">{error}</p>}

          <button
            onClick={() => { initWolfOrder(); setStep('wolforder') }}
            disabled={!groupsFull}
            className="w-full bg-green-600 text-white py-3 rounded-lg font-semibold disabled:opacity-50"
          >
            Next: Wolf Order →
          </button>
          {!groupsFull && (
            <p className="text-xs text-gray-400 text-center">Each group needs at least 2 players to continue</p>
          )}
        </div>
      </Layout>
    )
  }

  // ── Wolf order step ────────────────────────────────────────────────────────

  if (step === 'wolforder') {
    return (
      <Layout title="Wolf Order (Tee Throw)" onBack={() => setStep('groups')}>
        <div className="space-y-4">
          <p className="text-sm text-gray-500">
            Position 1 is Wolf on hole 1, position 2 on hole 2, etc. Cycles every 4 holes.
          </p>

          {groups.map((_, gi) => {
            const c = GROUP_COLORS[gi % GROUP_COLORS.length]
            return (
              <div key={gi} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className={`px-4 py-2 flex items-center justify-between text-sm font-semibold ${c.bg} ${c.text}`}>
                  <span>Group {gi + 1} Wolf Order</span>
                  <button
                    onClick={() => shuffleWolf(gi)}
                    className="text-xs font-medium px-2 py-1 rounded bg-white/60 hover:bg-white transition-colors"
                  >
                    🎲 Randomize
                  </button>
                </div>
                <div className="divide-y divide-gray-100">
                  {wolfOrder[gi].map((pid, idx) => {
                    const p = players.find((pl) => pl.id === pid)
                    return (
                      <div key={pid} className="flex items-center gap-3 px-4 py-3">
                        <span className={`w-6 h-6 rounded-full text-xs flex items-center justify-center font-bold
                          ${idx === 0 ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-100 text-gray-500'}`}>
                          {idx + 1}
                        </span>
                        <span className="flex-1 text-sm font-medium">{p?.name}</span>
                        <div className="flex gap-1">
                          <button
                            onClick={() => idx > 0 && moveWolf(gi, idx, idx - 1)}
                            disabled={idx === 0}
                            className="px-2 py-1 text-gray-400 disabled:opacity-20 text-lg leading-none"
                          >
                            ↑
                          </button>
                          <button
                            onClick={() => idx < wolfOrder[gi].length - 1 && moveWolf(gi, idx, idx + 1)}
                            disabled={idx === wolfOrder[gi].length - 1}
                            className="px-2 py-1 text-gray-400 disabled:opacity-20 text-lg leading-none"
                          >
                            ↓
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}

          {error && <p className="text-red-500 text-sm">{error}</p>}

          <button
            onClick={handleSave}
            disabled={loading}
            className="w-full bg-green-600 text-white py-3 rounded-lg font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? <Spinner size="sm" /> : 'Save & Start Round'}
          </button>
        </div>
      </Layout>
    )
  }
}

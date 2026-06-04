import { useState } from 'react'
import { useApp } from '../context/AppContext'
import { createOrUpdateRound, saveGroupings, createPlayer } from '../lib/db'
import Layout from '../components/Layout'
import Spinner from '../components/Spinner'

const GROUP_COLORS = [
  { bg: 'bg-green-900/40', text: 'text-green-400', btn: 'text-green-400' },
  { bg: 'bg-blue-900/40',  text: 'text-blue-400',  btn: 'text-blue-400'  },
  { bg: 'bg-purple-900/40', text: 'text-purple-400', btn: 'text-purple-400' },
  { bg: 'bg-orange-900/40', text: 'text-orange-400', btn: 'text-orange-400' },
]

export default function AdminSetupScreen({ onDone, onBack }) {
  const { state, actions } = useApp()
  const { players, rounds, tripId } = state

  const [step, setStep] = useState('round') // 'round' | 'groups' | 'wolforder'
  const [roundNumber, setRoundNumber] = useState(
    rounds.length > 0 ? rounds.length + 1 : 1
  )
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])
  const [dayLabel, setDayLabel] = useState('')

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
      const round = await createOrUpdateRound({ tripId, roundNumber, date, status: 'active', dayLabel: dayLabel || null })

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
            <label className="block text-sm font-medium text-gray-400 mb-1">Round Number</label>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setRoundNumber((n) => Math.max(1, n - 1))}
                disabled={roundNumber <= 1}
                className="w-10 h-10 rounded-lg border-2 border-gray-700 text-gray-400 font-bold text-xl disabled:opacity-30 flex items-center justify-center"
              >
                −
              </button>
              <div className="flex-1 text-center py-2.5 rounded-lg border-2 border-green-600 bg-green-900/40 text-green-400 font-semibold text-lg">
                Round {roundNumber}
              </div>
              <button
                onClick={() => setRoundNumber((n) => n + 1)}
                className="w-10 h-10 rounded-lg border-2 border-gray-700 text-gray-400 font-bold text-xl flex items-center justify-center"
              >
                +
              </button>
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-400 mb-1">Date</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
            <div className="w-28">
              <label className="block text-sm font-medium text-gray-400 mb-1">Day</label>
              <select
                value={dayLabel}
                onChange={(e) => setDayLabel(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-3 focus:outline-none focus:ring-2 focus:ring-green-500"
              >
                <option value="">—</option>
                <option value="Thursday">Thursday</option>
                <option value="Friday">Friday</option>
                <option value="Saturday">Saturday</option>
              </select>
            </div>
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

  function autoFillGroups(method) {
    const playerList = [...players]
    if (playerList.length < 2) return
    const groupCount = Math.max(2, Math.min(4, Math.ceil(playerList.length / 4)))
    const newGroups = Array.from({ length: groupCount }, () => [])
    if (method === 'balanced') {
      playerList.sort((a, b) => (b.handicap ?? 0) - (a.handicap ?? 0))
      playerList.forEach((p, i) => {
        const round = Math.floor(i / groupCount)
        const pos = i % groupCount
        newGroups[round % 2 === 0 ? pos : groupCount - 1 - pos].push(p.id)
      })
    } else {
      for (let i = playerList.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[playerList[i], playerList[j]] = [playerList[j], playerList[i]]
      }
      playerList.forEach((p, i) => newGroups[i % groupCount].push(p.id))
    }
    setGroups(newGroups)
    setWolfOrder(newGroups.map((g) => [...g]))
  }

  // ── Groups step ────────────────────────────────────────────────────────────

  if (step === 'groups') {
    const groupsFull = groups.length > 0 && groups.every((g) => g.length >= 2)

    return (
      <Layout title="Assign Groups" onBack={() => setStep('round')}>
        <div className="space-y-4">

          {/* Auto-fill */}
          {players.length >= 2 && (
            <div className="bg-gray-800 rounded-xl border border-gray-700 p-4 space-y-2">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Auto-fill Groups</p>
              <div className="flex gap-2">
                <button
                  onClick={() => autoFillGroups('balanced')}
                  className="flex-1 bg-green-700 text-white py-2 rounded-lg text-sm font-semibold"
                >
                  ⚖ Balanced by Handicap
                </button>
                <button
                  onClick={() => autoFillGroups('random')}
                  className="flex-1 bg-gray-700 text-gray-200 py-2 rounded-lg text-sm font-semibold"
                >
                  🎲 Random
                </button>
              </div>
              <p className="text-xs text-gray-600">Adjust manually below after filling</p>
            </div>
          )}

          {/* Add player inline */}
          <form onSubmit={handleAddPlayer} className="bg-gray-800 rounded-xl border border-gray-700 p-4 space-y-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Add Player to Trip</p>
            <div className="flex gap-2">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Name"
                className="flex-1 bg-gray-700 border border-gray-600 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 placeholder-gray-500"
              />
              <input
                type="number"
                value={newHandicap}
                onChange={(e) => setNewHandicap(e.target.value)}
                placeholder="Hdcp"
                min="0"
                max="54"
                className="w-16 bg-gray-700 border border-gray-600 text-white rounded-lg px-3 py-2 text-sm text-center focus:outline-none focus:ring-2 focus:ring-green-500"
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
                  <div key={p.id} className="bg-gray-700 rounded-full px-3 py-1.5 text-sm flex items-center gap-1.5">
                    <span className="font-medium text-gray-200">{p.name}</span>
                    <span className="text-gray-500">→</span>
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
              <div key={gi} className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
                <div className={`px-4 py-2 flex items-center justify-between text-sm font-semibold ${c.bg} ${c.text}`}>
                  <span>Group {gi + 1} ({group.length}/4)</span>
                  {groups.length > 1 && group.length === 0 && (
                    <button onClick={() => removeGroup(gi)} className="text-xs text-red-400 font-medium">Remove</button>
                  )}
                </div>
                <div className="divide-y divide-gray-700">
                  {group.map((pid) => {
                    const p = players.find((pl) => pl.id === pid)
                    return (
                      <div key={pid} className="flex items-center justify-between px-4 py-3">
                        <div>
                          <span className="text-sm font-medium text-gray-200">{p?.name}</span>
                          <span className="text-xs text-gray-500 ml-2">Hdcp {p?.handicap ?? 0}</span>
                        </div>
                        <button onClick={() => assignPlayer(pid, -1)} className="text-red-400 text-xs">Remove</button>
                      </div>
                    )
                  })}
                  {group.length === 0 && (
                    <p className="px-4 py-3 text-sm text-gray-500 italic">Empty</p>
                  )}
                </div>
              </div>
            )
          })}

          {/* Add group */}
          <button
            onClick={addGroup}
            className="w-full border-2 border-dashed border-gray-700 text-gray-500 py-2.5 rounded-xl text-sm font-medium hover:border-gray-600 transition-colors"
          >
            + Add Group
          </button>

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <button
            onClick={() => { initWolfOrder(); setStep('wolforder') }}
            disabled={!groupsFull}
            className="w-full bg-green-600 text-white py-3 rounded-lg font-semibold disabled:opacity-50"
          >
            Next: Wolf Order →
          </button>
          {!groupsFull && (
            <p className="text-xs text-gray-500 text-center">Each group needs at least 2 players to continue</p>
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
              <div key={gi} className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
                <div className={`px-4 py-2 flex items-center justify-between text-sm font-semibold ${c.bg} ${c.text}`}>
                  <span>Group {gi + 1} Wolf Order</span>
                  <button
                    onClick={() => shuffleWolf(gi)}
                    className="text-xs font-medium px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 transition-colors text-gray-300"
                  >
                    🎲 Randomize
                  </button>
                </div>
                <div className="divide-y divide-gray-700">
                  {wolfOrder[gi].map((pid, idx) => {
                    const p = players.find((pl) => pl.id === pid)
                    return (
                      <div key={pid} className="flex items-center gap-3 px-4 py-3">
                        <span className={`w-6 h-6 rounded-full text-xs flex items-center justify-center font-bold
                          ${idx === 0 ? 'bg-yellow-500/20 text-yellow-400' : 'bg-gray-700 text-gray-400'}`}>
                          {idx + 1}
                        </span>
                        <span className="flex-1 text-sm font-medium text-gray-200">{p?.name}</span>
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

          {error && <p className="text-red-400 text-sm">{error}</p>}

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

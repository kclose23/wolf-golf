import { useState } from 'react'
import { useApp } from '../context/AppContext'
import { createOrUpdateRound, saveGroupings } from '../lib/db'
import Layout from '../components/Layout'
import Spinner from '../components/Spinner'

export default function AdminSetupScreen({ onDone, onBack }) {
  const { state, actions } = useApp()
  const { players, rounds, tripId } = state

  const [step, setStep] = useState('round') // 'round' | 'groups' | 'wolforder'
  const [roundNumber, setRoundNumber] = useState(
    rounds.length > 0 ? Math.min(rounds.length + 1, 3) : 1
  )
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])

  // groups[0] = group 1 player ids, groups[1] = group 2 player ids
  const [groups, setGroups] = useState([[], []])
  const [wolfOrder, setWolfOrder] = useState([[], []]) // wolfOrder[groupIdx] = [pid1, pid2, pid3, pid4]

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const unassigned = players.filter((p) => !groups[0].includes(p.id) && !groups[1].includes(p.id))

  function assignPlayer(playerId, groupIdx) {
    setGroups((prev) => {
      const next = [prev[0].filter((id) => id !== playerId), prev[1].filter((id) => id !== playerId)]
      if (groupIdx >= 0) {
        next[groupIdx] = [...next[groupIdx], playerId].slice(0, 4)
      }
      return next
    })
    setWolfOrder((prev) => {
      const next = [...prev]
      next[0] = prev[0].filter((id) => id !== playerId)
      next[1] = prev[1].filter((id) => id !== playerId)
      return next
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

  // Initialize wolf order from group when moving to that step
  function initWolfOrder() {
    setWolfOrder(groups.map((g) => [...g]))
  }

  async function handleSave() {
    setLoading(true)
    setError('')
    try {
      const round = await createOrUpdateRound({ tripId, roundNumber, date, status: 'active' })

      const groupingRows = []
      for (let gi = 0; gi < 2; gi++) {
        const groupNum = gi + 1
        const order = wolfOrder[gi].length > 0 ? wolfOrder[gi] : groups[gi]
        order.forEach((playerId, idx) => {
          groupingRows.push({ playerId, groupNumber: groupNum, wolfPosition: idx + 1 })
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

  if (step === 'round') {
    return (
      <Layout title="Setup Round" onBack={onBack}>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Round Number</label>
            <div className="flex gap-2">
              {[1, 2, 3].map((n) => (
                <button
                  key={n}
                  onClick={() => setRoundNumber(n)}
                  className={`flex-1 py-3 rounded-lg border-2 font-semibold transition-colors
                    ${roundNumber === n ? 'border-green-600 text-green-600 bg-green-50' : 'border-gray-200 text-gray-600'}`}
                >
                  Round {n}
                </button>
              ))}
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

  if (step === 'groups') {
    const groupsFull = groups[0].length === 4 && groups[1].length === 4

    return (
      <Layout title="Assign Groups" onBack={() => setStep('round')}>
        <div className="space-y-4">
          {unassigned.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Unassigned ({unassigned.length})</p>
              <div className="flex flex-wrap gap-2">
                {unassigned.map((p) => (
                  <div key={p.id} className="bg-gray-100 rounded-full px-3 py-1.5 text-sm flex items-center gap-2">
                    <span>{p.name}</span>
                    <button onClick={() => assignPlayer(p.id, 0)} className="text-green-600 font-bold">1</button>
                    <button onClick={() => assignPlayer(p.id, 1)} className="text-blue-600 font-bold">2</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {[0, 1].map((gi) => (
            <div key={gi} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className={`px-4 py-2 text-sm font-semibold ${gi === 0 ? 'bg-green-50 text-green-800' : 'bg-blue-50 text-blue-800'}`}>
                Group {gi + 1} ({groups[gi].length}/4)
              </div>
              <div className="divide-y divide-gray-100">
                {groups[gi].map((pid) => {
                  const p = players.find((pl) => pl.id === pid)
                  return (
                    <div key={pid} className="flex items-center justify-between px-4 py-3">
                      <span className="text-sm font-medium">{p?.name}</span>
                      <button
                        onClick={() => assignPlayer(pid, -1)}
                        className="text-red-400 text-xs"
                      >
                        Remove
                      </button>
                    </div>
                  )
                })}
                {groups[gi].length === 0 && (
                  <p className="px-4 py-3 text-sm text-gray-400 italic">Empty — tap 1 or 2 above to assign players</p>
                )}
              </div>
            </div>
          ))}

          {error && <p className="text-red-500 text-sm">{error}</p>}

          <button
            onClick={() => { initWolfOrder(); setStep('wolforder') }}
            disabled={!groupsFull}
            className="w-full bg-green-600 text-white py-3 rounded-lg font-semibold disabled:opacity-50"
          >
            Next: Wolf Order →
          </button>
        </div>
      </Layout>
    )
  }

  if (step === 'wolforder') {
    return (
      <Layout title="Wolf Order (Tee Throw)" onBack={() => setStep('groups')}>
        <div className="space-y-4">
          <p className="text-sm text-gray-500">
            Drag to set order — Position 1 is Wolf on hole 1, position 2 on hole 2, etc.
          </p>

          {[0, 1].map((gi) => (
            <div key={gi} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className={`px-4 py-2 flex items-center justify-between text-sm font-semibold ${gi === 0 ? 'bg-green-50 text-green-800' : 'bg-blue-50 text-blue-800'}`}>
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
          ))}

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

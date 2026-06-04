import { useState, useEffect } from 'react'
import { useApp } from '../context/AppContext'
import { createOrUpdateRound, saveGroupings, createPlayer, saveCourseStub } from '../lib/db'
import Layout from '../components/Layout'
import Spinner from '../components/Spinner'

const GROUP_COLORS = [
  { bg: 'bg-green-900/40', text: 'text-green-400', btn: 'text-green-400' },
  { bg: 'bg-blue-900/40',  text: 'text-blue-400',  btn: 'text-blue-400'  },
  { bg: 'bg-purple-900/40', text: 'text-purple-400', btn: 'text-purple-400' },
  { bg: 'bg-orange-900/40', text: 'text-orange-400', btn: 'text-orange-400' },
]

function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export default function TripSetupScreen({ onDone, onBack }) {
  const { state, actions } = useApp()
  const { players, tripId } = state

  const [step, setStep] = useState('rounds') // 'rounds' | 'groups' | 'wolforders'
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // ── Step 1: Round configs ──────────────────────────────────────────────
  const [roundCount, setRoundCount] = useState(6)
  const [roundConfigs, setRoundConfigs] = useState(
    Array.from({ length: 6 }, () => ({ date: '', courseName: '', dayLabel: '' }))
  )

  // Keep roundConfigs array length synced with roundCount
  useEffect(() => {
    setRoundConfigs((prev) => {
      if (prev.length === roundCount) return prev
      if (prev.length < roundCount) {
        return [...prev, ...Array.from({ length: roundCount - prev.length }, () => ({ date: '', courseName: '', dayLabel: '' }))]
      }
      return prev.slice(0, roundCount)
    })
  }, [roundCount])

  function updateRoundConfig(idx, field, value) {
    setRoundConfigs((prev) => prev.map((c, i) => i === idx ? { ...c, [field]: value } : c))
  }

  // Quick-fill: when user sets date/course on R1 and taps "fill down", propagate to same-day pairs
  function fillCourseName(fromIdx) {
    const val = roundConfigs[fromIdx].courseName
    if (!val) return
    setRoundConfigs((prev) => prev.map((c, i) => i >= fromIdx ? { ...c, courseName: val } : c))
  }

  // ── Step 2: Groups ─────────────────────────────────────────────────────
  const [groups, setGroups] = useState([[]])

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
  }
  const [newName, setNewName] = useState('')
  const [newHandicap, setNewHandicap] = useState('0')
  const [addingPlayer, setAddingPlayer] = useState(false)

  const unassigned = players.filter((p) => !groups.some((g) => g.includes(p.id)))

  function assignPlayer(playerId, groupIdx) {
    setGroups((prev) => {
      const next = prev.map((g) => g.filter((id) => id !== playerId))
      if (groupIdx >= 0) next[groupIdx] = [...next[groupIdx], playerId].slice(0, 4)
      return next
    })
  }

  function addGroup() {
    setGroups((prev) => [...prev, []])
  }

  function removeGroup(gi) {
    setGroups((prev) => {
      const next = prev.filter((_, i) => i !== gi)
      return next.length ? next : [[]]
    })
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

  // ── Step 3: Wolf orders ────────────────────────────────────────────────
  // wolfOrders[roundIdx][groupIdx] = [playerId, ...]
  // Each round can have completely different group compositions + wolf order.
  const [wolfOrders, setWolfOrders] = useState([])

  // Shuffle ALL players across groups then set wolf order within each new group.
  // This means different players can be in different groups each round.
  function shuffleAcrossGroups(roundOrders) {
    const allPlayers = roundOrders.flat()
    const mixed = shuffle(allPlayers)
    const groupCount = roundOrders.length
    const base = Math.floor(mixed.length / groupCount)
    const extras = mixed.length % groupCount
    let offset = 0
    return roundOrders.map((_, gi) => {
      const size = base + (gi < extras ? 1 : 0)
      const group = mixed.slice(offset, offset + size)
      offset += size
      return group
    })
  }

  function initWolfOrders() {
    setWolfOrders(Array.from({ length: roundCount }, (_, ri) => {
      if (ri === 0) {
        // Round 1: keep the groups you defined, just shuffle wolf order within each group
        return groups.map((g) => shuffle([...g]))
      }
      // Rounds 2+: fully randomize who is in each group + wolf order
      return shuffleAcrossGroups(groups.map((g) => [...g]))
    }))
  }

  function shuffleAll() {
    setWolfOrders((prev) => prev.map(shuffleAcrossGroups))
  }

  function shuffleRound(roundIdx) {
    setWolfOrders((prev) => {
      const next = [...prev]
      next[roundIdx] = shuffleAcrossGroups(next[roundIdx])
      return next
    })
  }

  // ── Save ───────────────────────────────────────────────────────────────
  async function handleSave() {
    setSaving(true)
    setError('')
    try {
      let firstRoundId = null

      for (let ri = 0; ri < roundCount; ri++) {
        const cfg = roundConfigs[ri]
        const isFirst = ri === 0

        const round = await createOrUpdateRound({
          tripId,
          roundNumber: ri + 1,
          date: cfg.date || null,
          status: isFirst ? 'active' : 'pending',
          dayLabel: cfg.dayLabel || null,
        })
        if (isFirst) firstRoundId = round.id

        // Save course name stub if provided (holes filled later via Scan)
        if (cfg.courseName.trim()) {
          await saveCourseStub({ tripId, name: cfg.courseName.trim(), roundNumber: ri + 1 })
        }

        // Save groupings with wolf order for this round
        const groupingRows = []
        for (let gi = 0; gi < groups.length; gi++) {
          const order = wolfOrders[ri]?.[gi] || groups[gi]
          order.forEach((playerId, idx) => {
            groupingRows.push({ playerId, groupNumber: gi + 1, wolfOrder: idx + 1 })
          })
        }
        await saveGroupings(round.id, groupingRows)
      }

      if (firstRoundId) actions.setActiveRound(firstRoundId)
      await actions.reload()
      onDone()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  // ── Render: Step 1 — Round configs ─────────────────────────────────────

  if (step === 'rounds') {
    return (
      <Layout title="Trip Setup" onBack={onBack}>
        <div className="space-y-5">
          <p className="text-sm text-gray-400">
            Configure all your rounds up front. Round 1 starts immediately; the rest stay pending until you tap Start.
          </p>

          {/* Round count */}
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-2">How many rounds?</label>
            <div className="flex gap-2 flex-wrap">
              {[2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                <button
                  key={n}
                  onClick={() => setRoundCount(n)}
                  className={`w-11 h-11 rounded-lg text-sm font-bold border-2 transition-colors
                    ${roundCount === n
                      ? 'border-green-500 bg-green-900/40 text-green-400'
                      : 'border-gray-700 text-gray-400'}`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          {/* Per-round config */}
          <div className="space-y-2">
            <div className="grid grid-cols-[2rem_auto_1fr_1fr] gap-2 px-1 text-xs text-gray-500 font-medium uppercase tracking-wide">
              <span>#</span>
              <span>Day</span>
              <span>Date</span>
              <span>Course (optional)</span>
            </div>
            {roundConfigs.map((cfg, i) => (
              <div key={i} className="grid grid-cols-[2rem_auto_1fr_1fr] gap-2 items-center">
                <span className="text-xs font-bold text-gray-400 text-center">R{i + 1}</span>
                <select
                  value={cfg.dayLabel}
                  onChange={(e) => updateRoundConfig(i, 'dayLabel', e.target.value)}
                  className="bg-gray-800 border border-gray-700 text-white rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                >
                  <option value="">—</option>
                  <option value="Thursday">Thu</option>
                  <option value="Friday">Fri</option>
                  <option value="Saturday">Sat</option>
                </select>
                <input
                  type="date"
                  value={cfg.date}
                  onChange={(e) => updateRoundConfig(i, 'date', e.target.value)}
                  className="bg-gray-800 border border-gray-700 text-white rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 w-full"
                />
                <div className="relative">
                  <input
                    type="text"
                    value={cfg.courseName}
                    onChange={(e) => updateRoundConfig(i, 'courseName', e.target.value)}
                    placeholder="Augusta…"
                    className="bg-gray-800 border border-gray-700 text-white rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 w-full placeholder-gray-600"
                  />
                  {i === 0 && cfg.courseName && i < roundCount - 1 && (
                    <button
                      onClick={() => fillCourseName(0)}
                      title="Copy to all rounds"
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-green-500 font-bold px-1 py-0.5 rounded hover:bg-green-900/30"
                    >
                      ↓All
                    </button>
                  )}
                </div>
              </div>
            ))}
            <p className="text-xs text-gray-600 px-1">Courses can be scanned any time — name is just a label for now.</p>
          </div>

          <button
            onClick={() => setStep('groups')}
            className="w-full bg-green-600 text-white py-3 rounded-lg font-semibold"
          >
            Next: Assign Groups →
          </button>
        </div>
      </Layout>
    )
  }

  // ── Render: Step 2 — Groups ─────────────────────────────────────────────

  if (step === 'groups') {
    const groupsFull = groups.length > 0 && groups.every((g) => g.length >= 2)

    return (
      <Layout title="Assign Groups" onBack={() => setStep('rounds')}>
        <div className="space-y-4">
          <p className="text-sm text-gray-400">These groups apply to every round — you can change them per-round later.</p>

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

          {/* Add player */}
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
                min="0" max="54"
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

          {/* Unassigned */}
          {unassigned.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
                Unassigned ({unassigned.length}) — tap group to assign
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

          <button
            onClick={addGroup}
            className="w-full border-2 border-dashed border-gray-700 text-gray-500 py-2.5 rounded-xl text-sm font-medium hover:border-gray-600 transition-colors"
          >
            + Add Group
          </button>

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <button
            onClick={() => { initWolfOrders(); setStep('wolforders') }}
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

  // ── Render: Step 3 — Wolf orders ────────────────────────────────────────

  if (step === 'wolforders') {
    return (
      <Layout title="Wolf Order" onBack={() => setStep('groups')}>
        <div className="space-y-4">
          <p className="text-sm text-gray-400">
            Each round gets completely randomized groups and wolf order — different players
            can be grouped together every round. Adjust any round manually below.
          </p>

          {/* Shuffle all */}
          <button
            onClick={shuffleAll}
            className="w-full bg-gray-700 text-gray-200 py-2.5 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 hover:bg-gray-600 transition-colors"
          >
            🎲 Re-randomize All {roundCount} Rounds
          </button>

          {/* Per-round wolf order cards */}
          {Array.from({ length: roundCount }, (_, ri) => {
            const cfg = roundConfigs[ri]
            const label = [
              `Round ${ri + 1}`,
              cfg.date && new Date(cfg.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
              cfg.courseName,
            ].filter(Boolean).join(' · ')

            return (
              <div key={ri} className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
                <div className="px-4 py-2.5 flex items-center justify-between bg-gray-700/60">
                  <span className="text-sm font-semibold text-gray-200 truncate">{label}</span>
                  <button
                    onClick={() => shuffleRound(ri)}
                    className="text-xs text-gray-400 hover:text-gray-200 flex items-center gap-1 shrink-0 ml-2"
                  >
                    🎲 Re-randomize
                  </button>
                </div>
                <div className="divide-y divide-gray-700/50">
                  {groups.map((_, gi) => {
                    const c = GROUP_COLORS[gi % GROUP_COLORS.length]
                    const order = wolfOrders[ri]?.[gi] || []
                    return (
                      <div key={gi} className="px-4 py-2.5 flex items-center gap-2">
                        <span className={`text-xs font-semibold w-14 shrink-0 ${c.text}`}>
                          Group {gi + 1}
                        </span>
                        <div className="flex items-center gap-1 flex-wrap">
                          {order.map((pid, pos) => {
                            const p = players.find((pl) => pl.id === pid)
                            return (
                              <span key={pid} className="flex items-center gap-1">
                                <span className={`text-xs px-2 py-0.5 rounded-full font-medium
                                  ${pos === 0 ? 'bg-yellow-500/20 text-yellow-400' : 'bg-gray-700 text-gray-400'}`}>
                                  {p?.name?.split(' ')[0] || '?'}
                                </span>
                                {pos < order.length - 1 && <span className="text-gray-700 text-xs">›</span>}
                              </span>
                            )
                          })}
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
            disabled={saving}
            className="w-full bg-green-600 text-white py-3.5 rounded-xl font-bold disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saving ? <><Spinner size="sm" /> Saving…</> : `Save Trip — ${roundCount} Rounds Ready`}
          </button>
          <p className="text-xs text-gray-500 text-center -mt-1">
            Round 1 starts active. Rounds 2–{roundCount} stay pending until you start them.
          </p>
        </div>
      </Layout>
    )
  }

  return null
}

import { useState, useMemo } from 'react'
import { useApp } from '../context/AppContext'
import { upsertWolfHole } from '../lib/db'
import { queueScore, queueWolfHole, flushQueue } from '../lib/offline'
import { MULTIPLIERS, DECLARATION, determineWolfResult, strokesReceived } from '../lib/gameEngine'
import Layout from '../components/Layout'
import BottomNav from '../components/BottomNav'

// no module-level constant — computed per holeCount below

export default function ScoringScreen({ setScreen }) {
  const { state, actions } = useApp()
  const { players, groupings, scores, wolfHoles, activeRoundId, playerId, courses, rounds } = state

  const activeRound = rounds.find((r) => r.id === activeRoundId)
  const course = courses.find((c) => c.round_number === activeRound?.round_number)
  const holes = (course?.holes || []).sort((a, b) => a.hole_number - b.hole_number)
  const totalHoles = holes.length || 18

  // My group
  const myGrouping = groupings.find((g) => g.player_id === playerId)
  const myGroupNumber = myGrouping?.group_number
  const myGroupPlayers = groupings
    .filter((g) => g.group_number === myGroupNumber)
    .sort((a, b) => a.wolf_position - b.wolf_position)

  const isScorer = Boolean(myGrouping) // only players in a group can score

  const [holeIndex, setHoleIndex] = useState(0) // 0-based
  const holeNumber = holeIndex + 1
  const holeData = holes.find((h) => h.hole_number === holeNumber)

  // Wolf for this hole
  const wolfPosition = (holeNumber - 1) % 4
  const regularWolfId = myGroupPlayers[wolfPosition]?.player_id
  const wolfHole = wolfHoles.find(
    (w) => w.hole_number === holeNumber && w.group_number === myGroupNumber
  )

  // Cumulative wolf points for comeback detection
  const groupWolfPoints = useMemo(() => {
    const totals = Object.fromEntries(myGroupPlayers.map((g) => [g.player_id, 0]))
    for (const wh of wolfHoles.filter((w) => w.group_number === myGroupNumber)) {
      if (!wh.result || wh.result === 'push') continue
      const mult = MULTIPLIERS[wh.declaration] || 1
      const effectiveVal = (wh.carry_value || 0) + wh.base_value
      const pot = effectiveVal * mult
      const wolfId = wh.wolf_player_id
      const partnerId = wh.partner_player_id
      const ids = myGroupPlayers.map((g) => g.player_id)

      if (wh.declaration === DECLARATION.PARTNER) {
        const winners = [wolfId, partnerId].filter(Boolean)
        const losers = ids.filter((id) => !winners.includes(id))
        if (wh.result === 'wolf_win') {
          winners.forEach((id) => (totals[id] = (totals[id] || 0) + pot * losers.length))
          losers.forEach((id) => (totals[id] = (totals[id] || 0) - pot * winners.length))
        } else {
          winners.forEach((id) => (totals[id] = (totals[id] || 0) - pot * losers.length))
          losers.forEach((id) => (totals[id] = (totals[id] || 0) + pot * winners.length))
        }
      } else {
        const others = ids.filter((id) => id !== wolfId)
        if (wh.result === 'wolf_win') {
          totals[wolfId] = (totals[wolfId] || 0) + pot * others.length
          others.forEach((id) => (totals[id] = (totals[id] || 0) - pot))
        } else {
          totals[wolfId] = (totals[wolfId] || 0) - pot * others.length
          others.forEach((id) => (totals[id] = (totals[id] || 0) + pot))
        }
      }
    }
    return totals
  }, [wolfHoles, myGroupPlayers, myGroupNumber])

  // Comeback hole: lowest-points player becomes wolf
  const isComeback = holeNumber > totalHoles - 4
  const comebackWolfId = useMemo(() => {
    if (!isComeback) return null
    const minPts = Math.min(...Object.values(groupWolfPoints))
    return Object.entries(groupWolfPoints).find(([, pts]) => pts === minPts)?.[0] || regularWolfId
  }, [isComeback, groupWolfPoints, regularWolfId])
  const effectiveWolfId = isComeback ? comebackWolfId : regularWolfId
  const wolfPlayer = players.find((p) => p.id === effectiveWolfId)

  // Carry value
  const carryValue = useMemo(() => {
    let carry = 0
    for (let h = 1; h < holeNumber; h++) {
      const wh = wolfHoles.find((w) => w.hole_number === h && w.group_number === myGroupNumber)
      if (!wh || wh.result === 'push') carry += wh?.base_value || 1
      else carry = 0
    }
    return carry
  }, [wolfHoles, holeNumber, myGroupNumber])

  // Wolf state for this hole
  const [declaration, setDeclaration] = useState(wolfHole?.declaration || null)
  const [partnerId, setPartnerId] = useState(wolfHole?.partner_player_id || null)
  const [baseValue, setBaseValue] = useState(
    isComeback
      ? (wolfHole?.base_value || 1)
      : 1
  )
  const [showWolfPanel, setShowWolfPanel] = useState(false)

  // Scores for this hole
  const holeScores = Object.fromEntries(
    myGroupPlayers.map((g) => {
      const s = scores.find((sc) => sc.player_id === g.player_id && sc.hole_number === holeNumber && sc.round_id === activeRoundId)
      return [g.player_id, s?.gross_score ?? '']
    })
  )
  const [draftScores, setDraftScores] = useState(holeScores)

  // Navigate holes
  function goHole(dir) {
    const next = holeIndex + dir
    if (next < 0 || next >= totalHoles) return
    setHoleIndex(next)
    // Reset draft from stored scores for new hole
    const nextHole = next + 1
    const newDraft = Object.fromEntries(
      myGroupPlayers.map((g) => {
        const s = scores.find((sc) => sc.player_id === g.player_id && sc.hole_number === nextHole && sc.round_id === activeRoundId)
        return [g.player_id, s?.gross_score ?? '']
      })
    )
    setDraftScores(newDraft)
    const nextWh = wolfHoles.find((w) => w.hole_number === nextHole && w.group_number === myGroupNumber)
    setDeclaration(nextWh?.declaration || null)
    setPartnerId(nextWh?.partner_player_id || null)
    setBaseValue(nextWh?.base_value || 1)
    setShowWolfPanel(false)
  }

  function setScore(pid, value) {
    setDraftScores((prev) => ({ ...prev, [pid]: value }))
  }

  async function saveScores() {
    for (const [pid, gross] of Object.entries(draftScores)) {
      if (gross === '' || gross === null) continue
      const grossScore = parseInt(gross)
      actions.updateScore(activeRoundId, pid, holeNumber, grossScore)
      queueScore({ roundId: activeRoundId, playerId: pid, holeNumber, grossScore })
    }

    // Auto-compute wolf result if declaration set and all scores entered
    if (declaration && myGroupPlayers.every((g) => draftScores[g.player_id] !== '')) {
      await saveWolfHole(declaration, partnerId, baseValue, true)
    }

    flushQueue()
  }

  async function saveWolfHole(decl, partner, bv, withResult = false) {
    const netScores = {}
    for (const g of myGroupPlayers) {
      const gross = parseInt(draftScores[g.player_id])
      if (!isNaN(gross) && holeData) {
        netScores[g.player_id] = gross - strokesReceived(g.player?.handicap || 0, holeData.stroke_index)
      }
    }

    const wolfHoleData = {
      roundId: activeRoundId,
      groupNumber: myGroupNumber,
      holeNumber,
      wolfPlayerId: effectiveWolfId,
      partnerPlayerId: partner || null,
      declaration: decl,
      baseValue: bv,
      carryValue,
      result: withResult && Object.keys(netScores).length === myGroupPlayers.length
        ? determineWolfResult({ wolf_player_id: effectiveWolfId, partner_player_id: partner, declaration: decl }, netScores)
        : null,
    }

    actions.updateWolfHole({
      round_id: activeRoundId,
      group_number: myGroupNumber,
      hole_number: holeNumber,
      wolf_player_id: effectiveWolfId,
      partner_player_id: partner || null,
      declaration: decl,
      base_value: bv,
      carry_value: carryValue,
      result: wolfHoleData.result,
    })
    queueWolfHole(wolfHoleData)
    flushQueue()
  }

  if (!isScorer) {
    return (
      <Layout title="Scoring">
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="text-4xl mb-3">👁</div>
          <p className="text-gray-600 font-medium">View-only mode</p>
          <p className="text-sm text-gray-400 mt-1">You're not assigned to a scoring group this round.</p>
        </div>
        <BottomNav screen="score" setScreen={setScreen} />
      </Layout>
    )
  }

  const allScoresIn = myGroupPlayers.every((g) => draftScores[g.player_id] !== '')
  const currentHoleWh = wolfHoles.find((w) => w.hole_number === holeNumber && w.group_number === myGroupNumber)

  const par = holeData?.par || 4
  const totalPot = (carryValue + (isComeback ? baseValue : 1)) * (MULTIPLIERS[declaration] || 1)

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col max-w-md mx-auto">
      {/* Hole header */}
      <div className="bg-green-700 text-white px-4 pt-4 pb-3 sticky top-0 z-40">
        <div className="flex items-center justify-between mb-2">
          <button onClick={() => goHole(-1)} disabled={holeIndex === 0} className="text-white/70 disabled:opacity-20 text-2xl leading-none px-2">←</button>
          <div className="text-center">
            <div className="text-3xl font-bold">Hole {holeNumber}</div>
            <div className="text-green-200 text-sm">Par {par} · S.I. {holeData?.stroke_index ?? '—'} · {holeData?.yards ? `${holeData.yards}y` : ''}</div>
          </div>
          <button onClick={() => goHole(1)} disabled={holeIndex >= totalHoles - 1} className="text-white/70 disabled:opacity-20 text-2xl leading-none px-2">→</button>
        </div>

        {/* Hole progress dots */}
        <div className="flex gap-1 justify-center">
          {Array.from({ length: totalHoles }, (_, i) => {
            const h = i + 1
            const hasScore = myGroupPlayers.every((g) => scores.some((s) => s.player_id === g.player_id && s.hole_number === h && s.round_id === activeRoundId && s.gross_score !== null))
            return (
              <button
                key={i}
                onClick={() => { setHoleIndex(i); goHole(i - holeIndex) }}
                className={`h-1.5 rounded-full transition-all ${i === holeIndex ? 'w-4 bg-white' : hasScore ? 'w-1.5 bg-green-300' : 'w-1.5 bg-green-600'}`}
              />
            )
          })}
        </div>
      </div>

      <div className="flex-1 p-4 pb-32 space-y-4">
        {/* Score entry */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-2 bg-gray-50 border-b border-gray-100 text-xs font-semibold text-gray-500 uppercase tracking-wide flex justify-between">
            <span>Player</span>
            <span>Score (Net)</span>
          </div>
          {myGroupPlayers.map((g, idx) => {
            const p = players.find((pl) => pl.id === g.player_id)
            const gross = draftScores[g.player_id]
            const net = gross !== '' && holeData ? parseInt(gross) - strokesReceived(g.player?.handicap || p?.handicap || 0, holeData.stroke_index) : null
            const netVsPar = net !== null ? net - par : null
            const isWolf = g.player_id === effectiveWolfId
            const isMe = g.player_id === playerId
            return (
              <div key={g.player_id} className={`flex items-center px-4 py-3 border-b border-gray-100 last:border-0 ${isMe ? 'bg-green-50' : ''}`}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium text-sm truncate">{p?.name || 'Player'}</span>
                    {isWolf && <span className="text-xs bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded-full font-medium">Wolf</span>}
                    {isMe && <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-medium">Me</span>}
                    {g.player_id === partnerId && declaration === DECLARATION.PARTNER && (
                      <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full font-medium">Partner</span>
                    )}
                  </div>
                  <div className="text-xs text-gray-400">Hdcp {p?.handicap ?? 0} · {strokesReceived(g.player?.handicap || p?.handicap || 0, holeData?.stroke_index || 18)} stroke(s) this hole</div>
                </div>
                <div className="flex items-center gap-2">
                  {net !== null && (
                    <span className={`text-xs font-semibold px-2 py-1 rounded-full
                      ${netVsPar < 0 ? 'bg-red-100 text-red-700' : netVsPar === 0 ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {net} {netVsPar !== null ? (netVsPar === 0 ? 'E' : netVsPar > 0 ? `+${netVsPar}` : netVsPar) : ''}
                    </span>
                  )}
                  <ScoreInput
                    value={gross}
                    onChange={(v) => setScore(g.player_id, v)}
                    par={par}
                  />
                </div>
              </div>
            )
          })}
        </div>

        {/* Wolf Panel */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <button
            onClick={() => setShowWolfPanel(!showWolfPanel)}
            className="w-full px-4 py-3 flex items-center justify-between"
          >
            <div>
              <div className="text-sm font-semibold text-gray-900 text-left">
                Wolf: {wolfPlayer?.name || '—'}
                {isComeback && <span className="ml-2 text-xs bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded-full">Comeback</span>}
              </div>
              <div className="text-xs text-gray-400 text-left">
                {declaration ? `${declarationLabel(declaration)} · ${totalPot}pt pot` : 'Tap to declare'}
                {carryValue > 0 && <span className="text-orange-600"> · {carryValue}pt carry</span>}
              </div>
            </div>
            <span className="text-gray-400">{showWolfPanel ? '▲' : '▼'}</span>
          </button>

          {showWolfPanel && (
            <div className="px-4 pb-4 border-t border-gray-100 space-y-3">
              {isComeback && (
                <div className="mt-3">
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Base Value (Wolf sets 1–{Math.max(1, Math.max(...Object.values(groupWolfPoints)) - (groupWolfPoints[effectiveWolfId] || 0))})</label>
                  <div className="flex gap-2 flex-wrap">
                    {Array.from({ length: Math.max(1, Math.max(...Object.values(groupWolfPoints)) - (groupWolfPoints[effectiveWolfId] || 0)) }, (_, i) => i + 1).map((v) => (
                      <button
                        key={v}
                        onClick={() => setBaseValue(v)}
                        className={`w-9 h-9 rounded-lg text-sm font-semibold border-2 transition-colors
                          ${baseValue === v ? 'border-orange-500 bg-orange-50 text-orange-700' : 'border-gray-200 text-gray-600'}`}
                      >
                        {v}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <p className="text-xs font-medium text-gray-600 mb-1.5 mt-2">Declaration</p>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { id: DECLARATION.BLIND, label: 'Blind Wolf', sublabel: '4× — before hitting', color: 'purple' },
                    { id: DECLARATION.EARLY, label: 'Lone Wolf', sublabel: '3× — after own shot', color: 'red' },
                    { id: DECLARATION.LATE, label: 'Lone Wolf', sublabel: '2× — after all hit', color: 'orange' },
                    { id: DECLARATION.PARTNER, label: 'Pick Partner', sublabel: '1× — team play', color: 'blue' },
                  ].map((opt) => (
                    <button
                      key={opt.id}
                      onClick={() => {
                        setDeclaration(opt.id)
                        if (opt.id !== DECLARATION.PARTNER) setPartnerId(null)
                      }}
                      className={`p-3 rounded-lg border-2 text-left transition-colors
                        ${declaration === opt.id
                          ? `border-${opt.color}-500 bg-${opt.color}-50`
                          : 'border-gray-200'}`}
                    >
                      <div className={`text-sm font-semibold ${declaration === opt.id ? `text-${opt.color}-700` : 'text-gray-700'}`}>{opt.label}</div>
                      <div className="text-xs text-gray-400">{opt.sublabel}</div>
                    </button>
                  ))}
                </div>
              </div>

              {declaration === DECLARATION.PARTNER && (
                <div>
                  <p className="text-xs font-medium text-gray-600 mb-1.5">Wolf's Partner</p>
                  <div className="flex gap-2">
                    {myGroupPlayers.filter((g) => g.player_id !== effectiveWolfId).map((g) => {
                      const p = players.find((pl) => pl.id === g.player_id)
                      return (
                        <button
                          key={g.player_id}
                          onClick={() => setPartnerId(g.player_id)}
                          className={`flex-1 py-2 rounded-lg border-2 text-sm font-medium transition-colors
                            ${partnerId === g.player_id ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600'}`}
                        >
                          {p?.name}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {declaration && (
                <button
                  onClick={() => saveWolfHole(declaration, partnerId, isComeback ? baseValue : 1)}
                  className="w-full bg-yellow-500 text-white py-2.5 rounded-lg text-sm font-semibold"
                >
                  Save Wolf Declaration
                </button>
              )}
            </div>
          )}
        </div>

        {/* Save scores button */}
        <button
          onClick={saveScores}
          disabled={!myGroupPlayers.some((g) => draftScores[g.player_id] !== '')}
          className="w-full bg-green-600 text-white py-4 rounded-xl font-semibold text-base disabled:opacity-40"
        >
          {allScoresIn ? 'Save All Scores →' : 'Save Scores'}
        </button>

        {/* Hole summary if result known */}
        {currentHoleWh?.result && currentHoleWh.result !== 'push' && (
          <div className={`rounded-xl p-4 text-center ${currentHoleWh.result === 'wolf_win' ? 'bg-green-100' : 'bg-red-100'}`}>
            <div className="font-semibold text-sm">
              {currentHoleWh.result === 'wolf_win' ? '🐺 Wolf wins!' : '🎯 Wolf loses!'}
            </div>
            <div className="text-xs text-gray-600 mt-0.5">
              {(currentHoleWh.carry_value + currentHoleWh.base_value) * (MULTIPLIERS[currentHoleWh.declaration] || 1)} pts per player
            </div>
          </div>
        )}
        {currentHoleWh?.result === 'push' && (
          <div className="rounded-xl bg-gray-100 p-4 text-center">
            <div className="font-semibold text-sm text-gray-600">Push — carries to next hole</div>
          </div>
        )}
      </div>

      <BottomNav screen="score" setScreen={setScreen} />
    </div>
  )
}

function declarationLabel(d) {
  return { blind: 'Blind Wolf 4×', early: 'Lone Wolf 3×', late: 'Lone Wolf 2×', partner: 'Partner 1×' }[d] || d
}

// Inline numeric score input with +/- and direct tap
function ScoreInput({ value, onChange, par }) {
  const num = parseInt(value)
  const diff = isNaN(num) ? null : num - par

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={() => !isNaN(num) && onChange(String(Math.max(1, num - 1)))}
        className="w-8 h-8 rounded-full bg-gray-100 text-gray-600 font-bold text-lg flex items-center justify-center"
      >
        −
      </button>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode="numeric"
        min={1}
        max={15}
        className={`w-12 h-10 text-center text-xl font-bold rounded-lg border-2 focus:outline-none
          ${diff === null ? 'border-gray-200 text-gray-700'
          : diff < 0 ? 'border-red-300 text-red-600 bg-red-50'
          : diff === 0 ? 'border-green-300 text-green-700 bg-green-50'
          : diff === 1 ? 'border-gray-200 text-gray-700'
          : 'border-gray-200 text-gray-500'}`}
      />
      <button
        onClick={() => onChange(String(isNaN(num) ? par : num + 1))}
        className="w-8 h-8 rounded-full bg-gray-100 text-gray-600 font-bold text-lg flex items-center justify-center"
      >
        +
      </button>
    </div>
  )
}

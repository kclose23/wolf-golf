import { useState, useMemo, useEffect } from 'react'
import { useApp } from '../context/AppContext'
import { upsertScore, upsertWolfHole } from '../lib/db'
import { queueScore, queueWolfHole } from '../lib/offline'
import { MULTIPLIERS, DECLARATION, determineWolfResult, strokesReceived, effectiveStrokeIndex } from '../lib/gameEngine'
import Layout from '../components/Layout'
import BottomNav from '../components/BottomNav'

// Explicit Tailwind classes for each declaration type (dynamic strings get purged in prod)
const DECL_STYLE = {
  [DECLARATION.BLIND]:   { active: 'border-purple-500 bg-purple-900/40', text: 'text-purple-400' },
  [DECLARATION.EARLY]:   { active: 'border-red-500 bg-red-900/40',       text: 'text-red-400'    },
  [DECLARATION.LATE]:    { active: 'border-orange-500 bg-orange-900/40', text: 'text-orange-400' },
  [DECLARATION.PARTNER]: { active: 'border-blue-500 bg-blue-900/40',     text: 'text-blue-400'   },
  [DECLARATION.THREW]:   { active: 'border-amber-500 bg-amber-900/40',   text: 'text-amber-400'  },
}

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
    .sort((a, b) => a.wolf_order - b.wolf_order)

  const isScorer = Boolean(myGrouping) // only players in a group can score
  const isComplete = state.trip?.status === 'complete'

  const holeKey = `wolf_golf_hole_${activeRoundId}`
  const [holeIndex, setHoleIndex] = useState(() => {
    const saved = parseInt(localStorage.getItem(holeKey) || '0')
    return isNaN(saved) ? 0 : Math.max(0, Math.min(saved, totalHoles - 1))
  })
  useEffect(() => { localStorage.setItem(holeKey, String(holeIndex)) }, [holeKey, holeIndex])

  // Use actual hole number from course data (handles back-9 rounds where holes start at 10)
  const holeData = holes.length > 0 ? holes[holeIndex] : null
  const holeNumber = holeData?.hole_number ?? (holeIndex + 1)

  // Wolf for this hole — rotate by play order (index), not absolute hole number
  const wolfPosition = holeIndex % 4
  const regularWolfId = myGroupPlayers[wolfPosition]?.player_id
  const wolfHole = wolfHoles.find(
    (w) => w.hole_number === holeNumber && w.group_number === myGroupNumber
  )

  // Cumulative wolf points for comeback detection.
  // Must iterate holes in order and accumulate carry the same way the Wolf leaderboard tab does,
  // because carry_value is never stored in the DB — it's always recomputed from hole history.
  const groupWolfPoints = useMemo(() => {
    const totals = Object.fromEntries(myGroupPlayers.map((g) => [g.player_id, 0]))
    const ids = myGroupPlayers.map((g) => g.player_id)
    let carry = 0
    for (let i = 0; i < totalHoles; i++) {
      const hn = holes.length > 0 ? holes[i]?.hole_number : i + 1
      const wh = wolfHoles.find((w) => w.hole_number === hn && w.group_number === myGroupNumber)
      const isComebackHole = i >= totalHoles - 4
      if (!wh || !wh.result) {
        carry = isComebackHole ? 0 : carry + (wh?.base_value || 1)
        continue
      }
      const effectiveVal = carry + wh.base_value
      const mult = MULTIPLIERS[wh.declaration] || 1
      const pot = effectiveVal * mult
      const wolfId = wh.wolf_player_id
      const partnerId = wh.partner_player_id
      if (wh.result === 'push') { carry = isComebackHole ? 0 : carry + wh.base_value; continue }
      carry = 0
      if (wh.declaration === DECLARATION.PARTNER) {
        const wolfTeam = [wolfId, partnerId].filter(Boolean)
        const others = ids.filter((id) => !wolfTeam.includes(id))
        if (wh.result === 'wolf_win') {
          wolfTeam.forEach((id) => { if (id in totals) totals[id] += pot })
        } else {
          others.forEach((id) => { if (id in totals) totals[id] += pot })
        }
      } else if (wh.declaration === DECLARATION.THREW) {
        const throwerId = partnerId
        const others = ids.filter((id) => id !== throwerId)
        if (wh.result === 'wolf_win') {
          if (throwerId in totals) totals[throwerId] += pot
        } else {
          others.forEach((id) => { if (id in totals) totals[id] += pot })
        }
      } else {
        const others = ids.filter((id) => id !== wolfId)
        if (wh.result === 'wolf_win') {
          if (wolfId in totals) totals[wolfId] += pot
        } else {
          others.forEach((id) => { if (id in totals) totals[id] += pot })
        }
      }
    }
    return totals
  }, [wolfHoles, myGroupPlayers, myGroupNumber, holes, totalHoles])

  // Comeback hole: last 4 holes by play order (index), not absolute hole number
  const isComeback = holeIndex >= totalHoles - 4

  // All players tied for the lowest points (only relevant on comeback holes)
  const tiedLowPlayers = useMemo(() => {
    if (!isComeback || wolfHole?.wolf_player_id) return []
    const pts = Object.values(groupWolfPoints)
    if (!pts.length) return []
    const minPts = Math.min(...pts)
    return Object.entries(groupWolfPoints)
      .filter(([, p]) => p === minPts)
      .map(([id]) => id)
  }, [isComeback, wolfHole, groupWolfPoints])

  const needsTeeFlip = tiedLowPlayers.length > 1
  const [teeFlipWinnerId, setTeeFlipWinnerId] = useState(null)

  const comebackWolfId = useMemo(() => {
    if (!isComeback) return null
    // Saved hole: use stored wolf so navigating back doesn't shift the name
    if (wolfHole?.wolf_player_id) return wolfHole.wolf_player_id
    // Tie broken by tee flip
    if (teeFlipWinnerId) return teeFlipWinnerId
    // Single low player
    return tiedLowPlayers[0] || regularWolfId
  }, [isComeback, wolfHole, teeFlipWinnerId, tiedLowPlayers, regularWolfId])

  const effectiveWolfId = isComeback ? comebackWolfId : regularWolfId
  const wolfPlayer = players.find((p) => p.id === effectiveWolfId)

  // Carry value — iterate by play order (index) so back-9 uses actual hole numbers.
  // Comeback holes (last 4) never carry: a push on a comeback hole discards the pot.
  const carryValue = useMemo(() => {
    let carry = 0
    for (let i = 0; i < holeIndex; i++) {
      const hn = holes.length > 0 ? holes[i]?.hole_number : i + 1
      const wh = wolfHoles.find((w) => w.hole_number === hn && w.group_number === myGroupNumber)
      const isComebackHole = i >= totalHoles - 4
      if (!wh || wh.result === 'push') {
        carry = isComebackHole ? 0 : carry + (wh?.base_value || 1)
      } else {
        carry = 0
      }
    }
    return carry
  }, [wolfHoles, holeIndex, holes, totalHoles, myGroupNumber])

  // Wolf state for this hole
  const [declaration, setDeclaration] = useState(wolfHole?.declaration || null)
  const [partnerId, setPartnerId] = useState(wolfHole?.partner_player_id || null)
  const [baseValue, setBaseValue] = useState(
    isComeback
      ? (wolfHole?.base_value || 1)
      : 1
  )
  const [showWolfPanel, setShowWolfPanel] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [savedHole, setSavedHole] = useState(null)
  const [wolfSaved, setWolfSaved] = useState(false)

  // Scores for this hole
  const holeScores = Object.fromEntries(
    myGroupPlayers.map((g) => {
      const s = scores.find((sc) => sc.player_id === g.player_id && sc.hole_number === holeNumber && sc.round_id === activeRoundId)
      return [g.player_id, s?.gross_strokes ?? '']
    })
  )
  const [draftScores, setDraftScores] = useState(holeScores)

  // Navigate holes
  function goHole(dir) {
    const next = holeIndex + dir
    if (next < 0 || next >= totalHoles) return
    setHoleIndex(next)
    // Resolve actual hole number for back-9 rounds
    const nextHole = holes.length > 0 ? holes[next]?.hole_number : next + 1
    const newDraft = Object.fromEntries(
      myGroupPlayers.map((g) => {
        const s = scores.find((sc) => sc.player_id === g.player_id && sc.hole_number === nextHole && sc.round_id === activeRoundId)
        return [g.player_id, s?.gross_strokes ?? '']
      })
    )
    setDraftScores(newDraft)
    const nextWh = wolfHoles.find((w) => w.hole_number === nextHole && w.group_number === myGroupNumber)
    setDeclaration(nextWh?.declaration || null)
    setPartnerId(nextWh?.partner_player_id || null)
    setBaseValue(nextWh?.base_value || 1)
    setShowWolfPanel(false)
    setTeeFlipWinnerId(null)
  }

  function setScore(pid, value) {
    setDraftScores((prev) => ({ ...prev, [pid]: value }))
  }

  async function saveScores() {
    setSaving(true)
    setSaveError('')
    try {
      for (const [pid, gross] of Object.entries(draftScores)) {
        if (gross === '' || gross === null) continue
        const grossScore = parseInt(gross)
        actions.updateScore(activeRoundId, pid, holeNumber, grossScore)
        await upsertScore({ roundId: activeRoundId, playerId: pid, holeNumber, grossScore })
      }

      if (declaration && myGroupPlayers.every((g) => draftScores[g.player_id] !== '')) {
        await saveWolfHole(declaration, partnerId, baseValue, true)
      }

      setSavedHole(holeNumber)
      // Auto-advance to next hole after saving all scores
      if (allScoresIn && holeIndex < totalHoles - 1) {
        setTimeout(() => goHole(1), 600)
      } else {
        setTimeout(() => setSavedHole(null), 2000)
      }
    } catch (err) {
      setSaveError(err.message || 'Save failed — check your connection')
    } finally {
      setSaving(false)
    }
  }

  async function saveWolfHole(decl, partner, bv, withResult = false) {
    const netScores = {}
    const wolfHoleEsi = holeData ? effectiveStrokeIndex(holeData.stroke_index, holes) : 18
    for (const g of myGroupPlayers) {
      const gross = parseInt(draftScores[g.player_id])
      if (!isNaN(gross) && holeData) {
        const player = players.find((pl) => pl.id === g.player_id)
        netScores[g.player_id] = gross - strokesReceived(g.player?.handicap || player?.handicap || 0, wolfHoleEsi, holes.length || 18)
      }
    }

    const result = withResult && Object.keys(netScores).length === myGroupPlayers.length
      ? determineWolfResult({ wolf_player_id: effectiveWolfId, partner_player_id: partner, declaration: decl }, netScores)
      : null

    actions.updateWolfHole({
      round_id: activeRoundId,
      group_number: myGroupNumber,
      hole_number: holeNumber,
      wolf_player_id: effectiveWolfId,
      partner_player_id: partner || null,
      declaration: decl,
      base_value: bv,
      carry_value: carryValue,
      result,
    })

    await upsertWolfHole({
      roundId: activeRoundId,
      groupNumber: myGroupNumber,
      holeNumber,
      wolfPlayerId: effectiveWolfId,
      partnerPlayerId: partner || null,
      declaration: decl,
      baseValue: bv,
      result,
    })
  }

  if (isComplete) {
    return (
      <Layout title="Scoring">
        <div className="flex flex-col items-center justify-center py-20 text-center px-6">
          <div className="text-5xl mb-4">🏁</div>
          <p className="text-xl font-bold text-white mb-2">Game Complete</p>
          <p className="text-sm text-gray-400 mb-8">
            Scoring is locked. View final standings and settle up below.
          </p>
          <button
            onClick={() => setScreen('leaderboard')}
            className="w-full bg-green-600 text-white py-3 rounded-xl font-semibold mb-3"
          >
            View Leaderboard
          </button>
          <button
            onClick={() => setScreen('settlement')}
            className="w-full bg-gray-800 border border-gray-700 text-gray-300 py-3 rounded-xl font-semibold"
          >
            View Pay Up
          </button>
        </div>
        <BottomNav screen="score" setScreen={setScreen} />
      </Layout>
    )
  }

  if (!isScorer) {
    return (
      <Layout title="Scoring">
        <div className="flex flex-col items-center justify-center py-20 text-center px-6">
          <div className="text-4xl mb-3">👁</div>
          <p className="text-gray-600 font-medium">View-only mode</p>
          <p className="text-sm text-gray-400 mt-1 mb-6">
            You're not assigned to a scoring group this round.
            Ask the admin to add you, or tap below if you're on the wrong player.
          </p>
          <button
            onClick={() => actions.setPlayerId('')}
            className="text-sm text-green-600 underline font-medium mb-3"
          >
            Switch Player
          </button>
          <button
            onClick={() => {
              if (confirm('Leave this trip? Your session will be cleared and you can rejoin with the code.')) {
                actions.clearSession()
              }
            }}
            className="text-sm text-red-400 underline font-medium"
          >
            Leave Trip &amp; Start Over
          </button>
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
    <div className="min-h-screen bg-gray-900 flex flex-col max-w-md mx-auto">
      {/* Sticky error banner */}
      {saveError && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-red-600 text-white px-4 py-3 text-sm font-medium flex items-center justify-between max-w-md mx-auto">
          <span>{saveError}</span>
          <button onClick={() => setSaveError('')} className="ml-3 text-white/80 font-bold text-lg leading-none">×</button>
        </div>
      )}

      {/* Hole header */}
      <div className="bg-gray-900 border-b border-gray-800 px-4 pt-4 pb-3 sticky top-0 z-40">
        <div className="flex items-center justify-between mb-2">
          <button onClick={() => goHole(-1)} disabled={holeIndex === 0} className="text-gray-500 disabled:opacity-20 text-2xl leading-none px-2">←</button>
          <div className="text-center">
            <div className="text-3xl font-bold text-white">Hole {holeNumber}</div>
            <div className="text-green-400 text-sm">Par {par} · S.I. {holeData?.stroke_index ?? '—'} · {holeData?.yards ? `${holeData.yards}y` : ''}</div>
          </div>
          <button onClick={() => goHole(1)} disabled={holeIndex >= totalHoles - 1} className="text-gray-500 disabled:opacity-20 text-2xl leading-none px-2">→</button>
        </div>

        {/* Hole progress dots */}
        <div className="flex gap-1 justify-center">
          {Array.from({ length: totalHoles }, (_, i) => {
            const h = holes.length > 0 ? holes[i]?.hole_number : i + 1
            const hasScore = myGroupPlayers.every((g) => scores.some((s) => s.player_id === g.player_id && s.hole_number === h && s.round_id === activeRoundId && s.gross_strokes !== null))
            return (
              <button
                key={i}
                onClick={() => { setHoleIndex(i); goHole(i - holeIndex) }}
                className={`h-1.5 rounded-full transition-all ${i === holeIndex ? 'w-4 bg-green-400' : hasScore ? 'w-1.5 bg-green-600' : 'w-1.5 bg-gray-700'}`}
              />
            )
          })}
        </div>
      </div>

      <div className="flex-1 p-4 pb-32 space-y-4">
        {/* Score entry */}
        <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
          <div className="px-4 py-2 bg-gray-700 border-b border-gray-700 text-xs font-semibold text-gray-400 uppercase tracking-wide flex justify-between">
            <span>Player</span>
            <span>Score (Net)</span>
          </div>
          {myGroupPlayers.map((g, idx) => {
            const p = players.find((pl) => pl.id === g.player_id)
            const gross = draftScores[g.player_id]
            const holeEsi = holeData ? effectiveStrokeIndex(holeData.stroke_index, holes) : 18
            const net = gross !== '' && holeData ? parseInt(gross) - strokesReceived(g.player?.handicap || p?.handicap || 0, holeEsi, holes.length || 18) : null
            const netVsPar = net !== null ? net - par : null
            const isWolf = g.player_id === effectiveWolfId
            const isMe = g.player_id === playerId
            return (
              <div key={g.player_id} className={`flex items-center px-4 py-3 border-b border-gray-700 last:border-0 ${isMe ? 'bg-green-950/50' : ''}`}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-sm text-white truncate">{p?.name || 'Player'}</span>
                    {isWolf && <span className="text-xs bg-yellow-500/20 text-yellow-400 px-1.5 py-0.5 rounded-full font-medium">Wolf</span>}
                    {isMe && <span className="text-xs bg-green-500/20 text-green-400 px-1.5 py-0.5 rounded-full font-medium">Me</span>}
                    {g.player_id === partnerId && declaration === DECLARATION.PARTNER && (
                      <span className="text-xs bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded-full font-medium">Partner</span>
                    )}
                    {g.player_id === partnerId && declaration === DECLARATION.THREW && (
                      <span className="text-xs bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded-full font-medium">Thrower</span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500">Hdcp {p?.handicap ?? 0} · {strokesReceived(g.player?.handicap || p?.handicap || 0, holeEsi, holes.length || 18)} stroke(s)</div>
                </div>
                <div className="flex items-center gap-2">
                  {net !== null && (
                    <span className={`text-xs font-semibold px-2 py-1 rounded-full
                      ${netVsPar < 0 ? 'bg-red-900/50 text-red-400' : netVsPar === 0 ? 'bg-green-900/50 text-green-400' : 'bg-gray-700 text-gray-400'}`}>
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

        {/* Tee flip prompt when players are tied for comeback wolf */}
        {isComeback && needsTeeFlip && !wolfHole?.wolf_player_id && (
          <div className="bg-orange-950/40 rounded-xl border-2 border-orange-800 p-4">
            <div className="text-sm font-semibold text-orange-300 mb-0.5">Tee Flip Needed</div>
            <p className="text-xs text-orange-400 mb-3">
              {tiedLowPlayers.map((id) => players.find((p) => p.id === id)?.name).join(' & ')} are tied for low — flip a tee to pick the wolf
            </p>
            <div className="flex gap-2">
              {tiedLowPlayers.map((id) => {
                const p = players.find((pl) => pl.id === id)
                const selected = teeFlipWinnerId === id
                return (
                  <button
                    key={id}
                    onClick={() => setTeeFlipWinnerId(id)}
                    className={`flex-1 py-2.5 rounded-lg border-2 text-sm font-semibold transition-colors
                      ${selected ? 'border-orange-400 bg-orange-900/50 text-orange-300' : 'border-orange-800 bg-transparent text-orange-500'}`}
                  >
                    {p?.name}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Wolf Panel */}
        <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
          <button
            onClick={() => setShowWolfPanel(!showWolfPanel)}
            className="w-full px-4 py-3 flex items-center justify-between"
          >
            <div>
              <div className="text-sm font-semibold text-white text-left">
                Wolf: {needsTeeFlip && !teeFlipWinnerId && !wolfHole?.wolf_player_id ? '—' : (wolfPlayer?.name || '—')}
                {isComeback && <span className="ml-2 text-xs bg-orange-900/50 text-orange-400 px-1.5 py-0.5 rounded-full">Comeback</span>}
              </div>
              <div className="text-xs text-gray-500 text-left">
                {declaration ? `${declarationLabel(declaration)} · ${totalPot}pt pot` : 'Tap to declare'}
                {carryValue > 0 && <span className="text-orange-400"> · {carryValue}pt carry</span>}
              </div>
            </div>
            <span className="text-gray-600">{showWolfPanel ? '▲' : '▼'}</span>
          </button>

          {showWolfPanel && (
            <div className="px-4 pb-4 border-t border-gray-700 space-y-3">
              {isComeback && (
                <div className="mt-3">
                  <label className="block text-xs font-medium text-gray-400 mb-1.5">Base Value (Wolf sets 1–{Math.max(1, Math.max(...Object.values(groupWolfPoints)) - (groupWolfPoints[effectiveWolfId] || 0))})</label>
                  <div className="flex gap-2 flex-wrap">
                    {Array.from({ length: Math.max(1, Math.max(...Object.values(groupWolfPoints)) - (groupWolfPoints[effectiveWolfId] || 0)) }, (_, i) => i + 1).map((v) => (
                      <button
                        key={v}
                        onClick={() => setBaseValue(v)}
                        className={`w-9 h-9 rounded-lg text-sm font-semibold border-2 transition-colors
                          ${baseValue === v ? 'border-orange-400 bg-orange-900/40 text-orange-300' : 'border-gray-600 text-gray-400'}`}
                      >
                        {v}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <p className="text-xs font-medium text-gray-400 mb-1.5 mt-2">Declaration — tap to choose, then save</p>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { id: DECLARATION.BLIND,   label: 'Blind Wolf',   sublabel: '4× — before hitting'  },
                    { id: DECLARATION.EARLY,   label: 'Lone Wolf',    sublabel: '3× — after own shot'  },
                    { id: DECLARATION.LATE,    label: 'Lone Wolf',    sublabel: '2× — after all hit'   },
                    { id: DECLARATION.PARTNER, label: 'Pick Partner', sublabel: '1× — team play'       },
                  ].map((opt) => {
                    const style = DECL_STYLE[opt.id]
                    // Show PARTNER as active when partner has thrown
                    const active = declaration === opt.id ||
                      (opt.id === DECLARATION.PARTNER && declaration === DECLARATION.THREW)
                    return (
                      <button
                        key={opt.id}
                        onClick={() => {
                          setDeclaration(opt.id)
                          if (opt.id !== DECLARATION.PARTNER) setPartnerId(null)
                        }}
                        className={`p-3 rounded-lg border-2 text-left transition-colors ${active ? style.active : 'border-gray-600'}`}
                      >
                        <div className={`text-sm font-semibold ${active ? style.text : 'text-gray-300'}`}>{opt.label}</div>
                        <div className="text-xs text-gray-500">{opt.sublabel}</div>
                      </button>
                    )
                  })}
                </div>
              </div>

              {(declaration === DECLARATION.PARTNER || declaration === DECLARATION.THREW) && (
                <div>
                  <p className="text-xs font-medium text-gray-400 mb-1.5">Wolf's Partner</p>
                  <div className="flex gap-2">
                    {myGroupPlayers.filter((g) => g.player_id !== effectiveWolfId).map((g) => {
                      const p = players.find((pl) => pl.id === g.player_id)
                      const isSelected = partnerId === g.player_id
                      const isThrower = isSelected && declaration === DECLARATION.THREW
                      return (
                        <button
                          key={g.player_id}
                          onClick={() => {
                            setPartnerId(g.player_id)
                            if (declaration === DECLARATION.THREW) setDeclaration(DECLARATION.PARTNER)
                          }}
                          className={`flex-1 py-2 rounded-lg border-2 text-sm font-medium transition-colors
                            ${isThrower
                              ? 'border-amber-500 bg-amber-900/40 text-amber-300'
                              : isSelected
                                ? 'border-blue-500 bg-blue-900/40 text-blue-300'
                                : 'border-gray-600 text-gray-400'}`}
                        >
                          {p?.name}
                        </button>
                      )
                    })}
                  </div>

                  {partnerId && declaration === DECLARATION.PARTNER && (
                    <button
                      onClick={() => setDeclaration(DECLARATION.THREW)}
                      className="w-full mt-2 py-2.5 rounded-lg border-2 border-amber-600 bg-amber-900/30 text-amber-300 text-sm font-semibold"
                    >
                      🐺 Throw Wolf — partner goes lone (2×)
                    </button>
                  )}
                  {declaration === DECLARATION.THREW && (
                    <div className="mt-2 bg-amber-900/20 border border-amber-800 rounded-lg px-3 py-2 flex items-center justify-between">
                      <span className="text-xs text-amber-300 font-semibold">
                        {players.find((p) => p.id === partnerId)?.name} goes lone vs all 3 (2×)
                      </span>
                      <button
                        onClick={() => setDeclaration(DECLARATION.PARTNER)}
                        className="text-xs text-gray-500 underline ml-3"
                      >
                        undo
                      </button>
                    </div>
                  )}
                </div>
              )}

              {declaration && (
                <button
                  onClick={async () => {
                    setSaveError('')
                    setSaving(true)
                    setWolfSaved(false)
                    try {
                      await saveWolfHole(declaration, partnerId, isComeback ? baseValue : 1)
                      setWolfSaved(true)
                      setTimeout(() => setWolfSaved(false), 2000)
                    } catch (err) {
                      setSaveError(err.message || 'Failed to save wolf declaration')
                    } finally {
                      setSaving(false)
                    }
                  }}
                  disabled={saving}
                  className={`w-full py-2.5 rounded-lg text-sm font-semibold disabled:opacity-50 text-white transition-colors ${wolfSaved ? 'bg-green-500' : 'bg-yellow-500'}`}
                >
                  {saving ? 'Saving…' : wolfSaved ? 'Declaration Saved ✓' : 'Save Wolf Declaration'}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Save scores button */}
        <button
          onClick={saveScores}
          disabled={saving || !myGroupPlayers.some((g) => draftScores[g.player_id] !== '')}
          className="w-full bg-green-600 text-white py-4 rounded-xl font-semibold text-base disabled:opacity-40"
        >
          {saving ? 'Saving…' : savedHole === holeNumber ? 'Saved ✓' : allScoresIn ? 'Save All Scores →' : 'Save Scores'}
        </button>
        {!myGroupPlayers.some((g) => draftScores[g.player_id] !== '') && (
          <p className="text-xs text-gray-600 text-center -mt-2">Enter at least one score above to save</p>
        )}

        {/* Hole summary if result known */}
        {currentHoleWh?.result && currentHoleWh.result !== 'push' && (
          <div className={`rounded-xl p-4 text-center ${currentHoleWh.result === 'wolf_win' ? 'bg-green-900/40 border border-green-800' : 'bg-red-900/40 border border-red-800'}`}>
            <div className={`font-bold text-sm ${currentHoleWh.result === 'wolf_win' ? 'text-green-300' : 'text-red-300'}`}>
              {currentHoleWh.declaration === DECLARATION.THREW
                ? currentHoleWh.result === 'wolf_win' ? '🐺 Throw succeeds!' : '🎯 Throw fails!'
                : currentHoleWh.result === 'wolf_win' ? '🐺 Wolf wins!' : '🎯 Wolf loses!'}
            </div>
            <div className="text-xs text-gray-400 mt-0.5">
              {((currentHoleWh.carry_value || 0) + currentHoleWh.base_value) * (MULTIPLIERS[currentHoleWh.declaration] || 1)} pts per player
            </div>
          </div>
        )}
        {currentHoleWh?.result === 'push' && (
          <div className="rounded-xl bg-gray-700 border border-gray-600 p-4 text-center">
            <div className="font-semibold text-sm text-gray-300">
              {isComeback ? 'Push — no carry' : 'Push — carries to next hole'}
            </div>
          </div>
        )}
      </div>

      <BottomNav screen="score" setScreen={setScreen} />
    </div>
  )
}

function declarationLabel(d) {
  return { blind: 'Blind Wolf 4×', early: 'Lone Wolf 3×', late: 'Lone Wolf 2×', partner: 'Partner 1×', threw: 'Threw Wolf 2×' }[d] || d
}

// Inline numeric score input with +/- and direct tap
function ScoreInput({ value, onChange, par }) {
  const num = parseInt(value)
  const diff = isNaN(num) ? null : num - par

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={() => !isNaN(num) && onChange(String(Math.max(1, num - 1)))}
        className="w-8 h-8 rounded-full bg-gray-700 text-gray-300 font-bold text-lg flex items-center justify-center"
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
        className={`w-12 h-10 text-center text-xl font-bold rounded-lg border-2 focus:outline-none bg-gray-900
          ${diff === null ? 'border-gray-600 text-gray-300'
          : diff < 0 ? 'border-red-500 text-red-400'
          : diff === 0 ? 'border-green-500 text-green-400'
          : diff === 1 ? 'border-gray-600 text-gray-300'
          : 'border-gray-600 text-gray-500'}`}
      />
      <button
        onClick={() => onChange(String(isNaN(num) ? par : num + 1))}
        className="w-8 h-8 rounded-full bg-gray-700 text-gray-300 font-bold text-lg flex items-center justify-center"
      >
        +
      </button>
    </div>
  )
}

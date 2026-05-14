import { useMemo, useState } from 'react'
import { useApp } from '../context/AppContext'
import {
  netScore, stablefordPoints, strokesReceived,
  MULTIPLIERS, DECLARATION, determineWolfResult, calcSkins, skinsTotals, calcNassau,
} from '../lib/gameEngine'
import Layout from '../components/Layout'
import TabBar from '../components/TabBar'
import BottomNav from '../components/BottomNav'

const TABS = [
  { id: 'stableford', label: 'Stableford' },
  { id: 'wolf', label: 'Wolf' },
  { id: 'skins', label: 'Skins' },
  { id: 'nassau', label: 'Nassau' },
  { id: 'overall', label: 'Scorecard' },
]

export default function LeaderboardScreen({ setScreen }) {
  const { state } = useApp()
  const { players, groupings, scores, wolfHoles, courses, rounds, activeRoundId } = state
  const [tab, setTab] = useState('stableford')

  const activeRound = rounds.find((r) => r.id === activeRoundId)
  const course = courses.find((c) => c.round_number === activeRound?.round_number)
  const holes = useMemo(() => (course?.holes || []).sort((a, b) => a.hole_number - b.hole_number), [course])

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col max-w-md mx-auto">
      <header className="bg-white border-b border-gray-200 px-4 py-3 sticky top-0 z-40">
        <h1 className="text-base font-semibold text-gray-900">Leaderboard</h1>
      </header>

      <TabBar tabs={TABS} active={tab} onChange={setTab} />

      <div className="flex-1 pb-24">
        {tab === 'stableford' && <StablefordTab players={players} groupings={groupings} scores={scores} courses={courses} rounds={rounds} holes={holes} />}
        {tab === 'wolf' && <WolfTab players={players} groupings={groupings} wolfHoles={wolfHoles} holes={holes} activeRoundId={activeRoundId} />}
        {tab === 'skins' && <SkinsTab players={players} groupings={groupings} scores={scores} holes={holes} activeRoundId={activeRoundId} />}
        {tab === 'nassau' && <NassauTab players={players} groupings={groupings} scores={scores} holes={holes} activeRoundId={activeRoundId} />}
        {tab === 'overall' && <ScorecardTab players={players} groupings={groupings} scores={scores} holes={holes} activeRoundId={activeRoundId} />}
      </div>

      <BottomNav screen="leaderboard" setScreen={setScreen} />
    </div>
  )
}

// ── Stableford ─────────────────────────────────────────────────────────────

function StablefordTab({ players, groupings, scores, courses, rounds }) {
  const roundNumbers = useMemo(
    () => rounds.map((r) => r.round_number).sort((a, b) => a - b),
    [rounds]
  )

  const playerTotals = useMemo(() => {
    const totals = {}

    for (const round of rounds) {
      const course = courses.find((c) => c.round_number === round.round_number)
      if (!course) continue
      const holes = course.holes || []

      const roundGroupings = groupings.filter((g) => g.round_id === round.id)

      for (const g of roundGroupings) {
        const p = players.find((pl) => pl.id === g.player_id)
        if (!p) continue
        if (!totals[p.id]) totals[p.id] = { player: p, rounds: {}, total: 0 }

        for (const hole of holes) {
          const s = scores.find((sc) => sc.player_id === p.id && sc.hole_number === hole.hole_number && sc.round_id === round.id)
          if (!s || s.gross_strokes === null) continue
          const net = netScore(s.gross_strokes, p.handicap || 0, hole.stroke_index)
          const pts = stablefordPoints(net - hole.par)
          totals[p.id].rounds[round.round_number] = (totals[p.id].rounds[round.round_number] || 0) + pts
          totals[p.id].total += pts
        }
      }
    }

    return Object.values(totals).sort((a, b) => b.total - a.total)
  }, [players, groupings, scores, courses, rounds])

  if (!playerTotals.length) return <EmptyState message="Scores will appear here as players complete holes." />

  return (
    <div className="p-4 space-y-2">
      <p className="text-xs text-gray-400 text-center mb-3">
        Trip champion · Higher is better · Eagle=4 Birdie=3 Par=2 Bogey=1 Double=0
      </p>
      {playerTotals.map((pt, i) => (
        <div key={pt.player.id} className="bg-white rounded-xl border border-gray-200 px-4 py-3 flex items-center gap-3">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold
            ${i === 0 ? 'bg-yellow-100 text-yellow-700' : i === 1 ? 'bg-gray-100 text-gray-600' : i === 2 ? 'bg-orange-100 text-orange-700' : 'bg-gray-50 text-gray-400'}`}>
            {i + 1}
          </div>
          <div className="flex-1">
            <div className="font-semibold text-sm text-gray-900">{pt.player.name}</div>
            <div className="text-xs text-gray-400">
              {roundNumbers.map((r) => `R${r}: ${pt.rounds[r] ?? '—'}`).join(' · ')}
            </div>
          </div>
          <div className="text-xl font-bold text-green-700">{pt.total}</div>
        </div>
      ))}
    </div>
  )
}

// ── Wolf ───────────────────────────────────────────────────────────────────

function WolfTab({ players, groupings, wolfHoles, holes, activeRoundId }) {
  const holeCount = holes.length || 18
  const { deltas, holeLog } = useMemo(() => {
    const roundGroupings = groupings.filter((g) => g.round_id === activeRoundId)
    const deltas = {}
    const holeLog = []

    const groupNums = [...new Set(roundGroupings.map((g) => g.group_number))].sort((a, b) => a - b)
    for (const groupNum of groupNums) {
      const gPlayers = roundGroupings.filter((g) => g.group_number === groupNum).sort((a, b) => a.wolf_order - b.wolf_order)
      if (!gPlayers.length) continue

      gPlayers.forEach((g) => (deltas[g.player_id] = deltas[g.player_id] || 0))

      let carry = 0
      for (let hole = 1; hole <= holeCount; hole++) {
        const wh = wolfHoles.find((w) => w.hole_number === hole && w.group_number === groupNum)
        if (!wh || !wh.result) { carry += wh?.base_value || 1; continue }

        const effectiveVal = carry + wh.base_value
        const mult = MULTIPLIERS[wh.declaration] || 1
        const pot = effectiveVal * mult
        const ids = gPlayers.map((g) => g.player_id)

        holeLog.push({
          hole,
          groupNum,
          wolfId: wh.wolf_player_id,
          partnerId: wh.partner_player_id,
          declaration: wh.declaration,
          pot,
          result: wh.result,
          carry: carry > 0,
        })

        if (wh.result === 'push') { carry += wh.base_value; continue }
        carry = 0

        if (wh.declaration === DECLARATION.PARTNER) {
          const winners = [wh.wolf_player_id, wh.partner_player_id].filter(Boolean)
          const losers = ids.filter((id) => !winners.includes(id))
          if (wh.result === 'wolf_win') {
            winners.forEach((id) => (deltas[id] += pot * losers.length))
            losers.forEach((id) => (deltas[id] -= pot * winners.length))
          } else {
            winners.forEach((id) => (deltas[id] -= pot * losers.length))
            losers.forEach((id) => (deltas[id] += pot * winners.length))
          }
        } else {
          const others = ids.filter((id) => id !== wh.wolf_player_id)
          if (wh.result === 'wolf_win') {
            deltas[wh.wolf_player_id] += pot * others.length
            others.forEach((id) => (deltas[id] -= pot))
          } else {
            deltas[wh.wolf_player_id] -= pot * others.length
            others.forEach((id) => (deltas[id] += pot))
          }
        }
      }
    }

    return { deltas, holeLog }
  }, [groupings, wolfHoles, activeRoundId, holeCount])

  const sorted = Object.entries(deltas).sort((a, b) => b[1] - a[1])

  if (!sorted.length) return <EmptyState message="Wolf scores will appear as holes are played." />

  return (
    <div className="p-4 space-y-4">
      <div className="space-y-2">
        {sorted.map(([pid, pts], i) => {
          const p = players.find((pl) => pl.id === pid)
          return (
            <div key={pid} className="bg-white rounded-xl border border-gray-200 px-4 py-3 flex items-center gap-3">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold
                ${i === 0 ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-50 text-gray-400'}`}>
                {i + 1}
              </div>
              <div className="flex-1 font-semibold text-sm">{p?.name}</div>
              <div className={`text-lg font-bold ${pts > 0 ? 'text-green-600' : pts < 0 ? 'text-red-500' : 'text-gray-500'}`}>
                {pts > 0 ? '+' : ''}{pts}
              </div>
            </div>
          )
        })}
      </div>

      {holeLog.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide bg-gray-50">
            Hole Log
          </div>
          <div className="divide-y divide-gray-100">
            {holeLog.map((entry, i) => {
              const wolf = players.find((p) => p.id === entry.wolfId)
              return (
                <div key={i} className="px-4 py-2.5 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium">
                      H{entry.hole} — {wolf?.name}
                      {entry.carry && <span className="text-xs text-orange-600 ml-1">(carry)</span>}
                    </div>
                    <div className="text-xs text-gray-400">
                      {declarationShort(entry.declaration)} · {entry.pot}pt
                    </div>
                  </div>
                  <div className={`text-sm font-semibold ${entry.result === 'wolf_win' ? 'text-green-600' : entry.result === 'wolf_lose' ? 'text-red-500' : 'text-gray-400'}`}>
                    {entry.result === 'wolf_win' ? 'Win' : entry.result === 'wolf_lose' ? 'Lose' : 'Push'}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function declarationShort(d) {
  return { blind: 'Blind 4×', early: 'Lone 3×', late: 'Lone 2×', partner: 'Partner 1×' }[d] || d
}

// ── Skins ──────────────────────────────────────────────────────────────────

function SkinsTab({ players, groupings, scores, holes, activeRoundId }) {
  const { skinResults, totals } = useMemo(() => {
    const roundGroupings = groupings
      .filter((g) => g.round_id === activeRoundId)
      .map((g) => ({ ...g, player: players.find((p) => p.id === g.player_id) }))

    if (!roundGroupings.length || !holes.length) return { skinResults: [], totals: {} }

    const skinResults = calcSkins(
      scores.filter((s) => s.round_id === activeRoundId),
      roundGroupings,
      holes,
      1
    )
    const totals = skinsTotals(skinResults)
    return { skinResults, totals }
  }, [players, groupings, scores, holes, activeRoundId])

  const sortedPlayers = Object.entries(totals).sort((a, b) => b[1] - a[1])

  return (
    <div className="p-4 space-y-4">
      {sortedPlayers.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-gray-400 text-center mb-2">Full field · Net score · Carry on ties</p>
          {sortedPlayers.map(([pid, val], i) => {
            const p = players.find((pl) => pl.id === pid)
            return (
              <div key={pid} className="bg-white rounded-xl border border-gray-200 px-4 py-3 flex items-center gap-3">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold
                  ${i === 0 ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-50 text-gray-400'}`}>
                  {i + 1}
                </div>
                <div className="flex-1 font-semibold text-sm">{p?.name}</div>
                <div className="text-lg font-bold text-green-600">{val} skin{val !== 1 ? 's' : ''}</div>
              </div>
            )
          })}
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide bg-gray-50 grid grid-cols-4">
          <span>Hole</span>
          <span className="text-center">Par</span>
          <span className="text-center">Value</span>
          <span className="text-right">Winner</span>
        </div>
        <div className="divide-y divide-gray-100">
          {skinResults.map((skin) => {
            const winner = skin.winnerId ? players.find((p) => p.id === skin.winnerId) : null
            return (
              <div key={skin.holeNumber} className="px-4 py-2.5 grid grid-cols-4 items-center">
                <span className="text-sm font-medium text-gray-700">{skin.holeNumber}</span>
                <span className="text-center text-sm text-gray-500">{holes.find((h) => h.hole_number === skin.holeNumber)?.par}</span>
                <span className={`text-center text-sm font-semibold ${skin.value > 1 ? 'text-orange-600' : 'text-gray-600'}`}>
                  {skin.value > 0 ? skin.value : '—'}
                </span>
                <span className="text-right text-sm">
                  {skin.pending ? <span className="text-gray-300 italic">pending</span>
                    : skin.push ? <span className="text-gray-400 italic">carry</span>
                    : winner ? <span className="font-medium text-green-700">{winner.name.split(' ')[0]}</span>
                    : '—'}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── Nassau ─────────────────────────────────────────────────────────────────

function NassauTab({ players, groupings, scores, holes, activeRoundId }) {
  const nassauData = useMemo(() => {
    const results = []
    const groupNums = [...new Set(groupings.filter((g) => g.round_id === activeRoundId).map((g) => g.group_number))].sort((a, b) => a - b)
    for (const groupNum of groupNums) {
      const roundGroupings = groupings
        .filter((g) => g.round_id === activeRoundId && g.group_number === groupNum)
        .map((g) => ({ ...g, player: players.find((p) => p.id === g.player_id) }))
      if (!roundGroupings.length) continue

      const roundScores = scores.filter((s) => s.round_id === activeRoundId)
      const result = calcNassau(roundScores, roundGroupings, holes, groupNum)
      results.push(result)
    }
    return results
  }, [players, groupings, scores, holes, activeRoundId])

  if (!nassauData.length) return <EmptyState message="Nassau results will appear as scores are entered." />

  return (
    <div className="p-4 space-y-4">
      {nassauData.map((nr) => (
        <div key={nr.groupNumber} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className={`px-4 py-2 text-sm font-semibold ${nr.groupNumber === 1 ? 'bg-green-50 text-green-800' : 'bg-blue-50 text-blue-800'}`}>
            Group {nr.groupNumber}
          </div>
          <div className="divide-y divide-gray-100">
            {/* Standings */}
            {Object.entries(nr.netTotals)
              .sort((a, b) => a[1].total - b[1].total)
              .map(([pid, totals]) => {
                const p = players.find((pl) => pl.id === pid)
                return (
                  <div key={pid} className="px-4 py-3 flex items-center justify-between">
                    <div className="font-medium text-sm">{p?.name}</div>
                    <div className="flex gap-4 text-xs text-gray-500">
                      <span>F: {totals.front || '—'}</span>
                      <span>B: {totals.back || '—'}</span>
                      <span className="font-semibold text-gray-800">T: {totals.total || '—'}</span>
                    </div>
                  </div>
                )
              })}
          </div>
          <div className="px-4 py-2 bg-gray-50 border-t border-gray-100 grid grid-cols-3 text-xs text-center gap-2">
            {['front', 'back', 'overall'].map((seg) => {
              const winnerId = nr[`${seg}Winner`]
              const winner = winnerId ? players.find((p) => p.id === winnerId) : null
              return (
                <div key={seg}>
                  <div className="text-gray-400 capitalize">{seg}</div>
                  <div className="font-semibold text-gray-800">{winner ? winner.name.split(' ')[0] : 'TBD'}</div>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Scorecard ──────────────────────────────────────────────────────────────

function ScorecardTab({ players, groupings, scores, holes, activeRoundId }) {
  const roundGroupings = groupings
    .filter((g) => g.round_id === activeRoundId)
    .sort((a, b) => a.group_number - b.group_number || a.wolf_order - b.wolf_order)
    .map((g) => ({ ...g, player: players.find((p) => p.id === g.player_id) }))

  if (!roundGroupings.length || !holes.length) return <EmptyState message="No scorecard data yet." />

  const front = holes.filter((h) => h.hole_number <= 9)
  const back = holes.filter((h) => h.hole_number > 9)

  return (
    <div className="overflow-x-auto">
      {[...new Set(roundGroupings.map((g) => g.group_number))].sort((a, b) => a - b).map((groupNum) => {
        const gPlayers = roundGroupings.filter((g) => g.group_number === groupNum)
        if (!gPlayers.length) return null
        return (
          <div key={groupNum} className="mb-4">
            <div className={`px-4 py-2 text-xs font-bold uppercase tracking-wide ${groupNum === 1 ? 'text-green-700' : 'text-blue-700'}`}>
              Group {groupNum}
            </div>
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-gray-100">
                  <th className="px-2 py-1.5 text-left font-semibold text-gray-600 w-20">Player</th>
                  {holes.map((h) => (
                    <th key={h.hole_number} className={`px-1 py-1.5 text-center font-semibold w-8
                      ${h.hole_number === 9 ? 'border-r-2 border-gray-300' : ''}
                      ${h.hole_number <= 9 ? 'text-gray-600' : 'text-gray-500'}`}>
                      {h.hole_number}
                    </th>
                  ))}
                  <th className="px-2 py-1.5 text-center font-semibold text-gray-700 w-10">TOT</th>
                </tr>
                <tr className="bg-gray-50">
                  <td className="px-2 py-1 text-gray-400">Par</td>
                  {holes.map((h) => (
                    <td key={h.hole_number} className={`px-1 py-1 text-center text-gray-500 ${h.hole_number === 9 ? 'border-r-2 border-gray-300' : ''}`}>
                      {h.par}
                    </td>
                  ))}
                  <td className="px-2 py-1 text-center text-gray-600 font-medium">
                    {holes.reduce((s, h) => s + h.par, 0)}
                  </td>
                </tr>
              </thead>
              <tbody>
                {gPlayers.map((g) => {
                  const roundScores = scores.filter((s) => s.round_id === activeRoundId && s.player_id === g.player_id)
                  const totalGross = roundScores.reduce((s, sc) => s + (sc.gross_strokes || 0), 0)
                  return (
                    <tr key={g.player_id} className="border-t border-gray-100">
                      <td className="px-2 py-1.5 font-medium text-gray-800 whitespace-nowrap">{g.player?.name?.split(' ')[0]}</td>
                      {holes.map((h) => {
                        const s = roundScores.find((sc) => sc.hole_number === h.hole_number)
                        const gross = s?.gross_strokes
                        const par = h.par
                        const diff = gross != null ? gross - par : null
                        return (
                          <td key={h.hole_number} className={`px-1 py-1.5 text-center ${h.hole_number === 9 ? 'border-r-2 border-gray-300' : ''}`}>
                            {gross != null ? (
                              <span className={`inline-flex items-center justify-center w-6 h-6 rounded text-xs font-semibold
                                ${diff <= -2 ? 'bg-yellow-200 text-yellow-800'
                                  : diff === -1 ? 'bg-red-100 text-red-700 rounded-full'
                                  : diff === 0 ? 'text-green-700'
                                  : diff === 1 ? 'text-gray-700'
                                  : 'text-gray-400'}`}>
                                {gross}
                              </span>
                            ) : (
                              <span className="text-gray-200">—</span>
                            )}
                          </td>
                        )
                      })}
                      <td className="px-2 py-1.5 text-center font-bold text-gray-900">
                        {totalGross || '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )
      })}
    </div>
  )
}

function EmptyState({ message }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center px-6">
      <div className="text-4xl mb-3">⛳</div>
      <p className="text-gray-500 text-sm">{message}</p>
    </div>
  )
}

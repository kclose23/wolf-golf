import { useMemo, useState, useEffect } from 'react'
import { useApp } from '../context/AppContext'
import {
  netScore, stablefordPoints, strokesReceived, effectiveStrokeIndex,
  MULTIPLIERS, DECLARATION, determineWolfResult, calcSkins, skinsTotals, calcNassau,
} from '../lib/gameEngine'
import Layout from '../components/Layout'
import TabBar from '../components/TabBar'
import BottomNav from '../components/BottomNav'

const TABS = [
  { id: 'wolf', label: 'Wolf' },
  { id: 'leaders', label: 'Leaders' },
  { id: 'skins', label: 'Skins' },
  { id: 'nassau', label: 'Nassau' },
  { id: 'overall', label: 'Scorecard' },
]

export default function LeaderboardScreen({ setScreen }) {
  const { state } = useApp()
  const { players, groupings, scores, wolfHoles, courses, rounds, activeRoundId } = state
  const [tab, setTab] = useState('wolf')

  const activeRound = rounds.find((r) => r.id === activeRoundId)
  const course = courses.find((c) => c.round_number === activeRound?.round_number)
  const holes = useMemo(() => (course?.holes || []).sort((a, b) => a.hole_number - b.hole_number), [course])

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col max-w-md mx-auto">
      <header className="bg-gray-900 border-b border-gray-800 px-4 py-3 sticky top-0 z-40">
        <h1 className="text-base font-semibold text-white">Leaderboard</h1>
      </header>

      <TabBar tabs={TABS} active={tab} onChange={setTab} />

      <div className="flex-1 pb-24">
        {tab === 'leaders' && <TournamentBoardTab players={players} groupings={groupings} scores={scores} courses={courses} rounds={rounds} />}
        {tab === 'wolf' && <WolfTab players={players} groupings={groupings} wolfHoles={wolfHoles} holes={holes} activeRoundId={activeRoundId} />}
        {tab === 'skins' && <SkinsTab players={players} groupings={groupings} scores={scores} holes={holes} activeRoundId={activeRoundId} />}
        {tab === 'nassau' && <NassauTab players={players} groupings={groupings} scores={scores} holes={holes} activeRoundId={activeRoundId} />}
        {tab === 'overall' && <ScorecardTab players={players} groupings={groupings} scores={scores} holes={holes} activeRoundId={activeRoundId} />}
      </div>

      <BottomNav screen="leaderboard" setScreen={setScreen} />
    </div>
  )
}

// ── Tournament Board ────────────────────────────────────────────────────────

function PosBadge({ pos, small }) {
  const sz = small ? 'w-5 h-5 text-[10px]' : 'w-6 h-6 text-xs'
  const cl =
    pos === 1 ? 'bg-yellow-500 text-gray-900' :
    pos === 2 ? 'bg-gray-400 text-gray-900' :
    pos === 3 ? 'bg-amber-700 text-white' :
    'bg-gray-700 text-gray-400'
  return (
    <span className={`inline-flex items-center justify-center rounded-sm font-bold ${sz} ${cl}`}>
      {pos}
    </span>
  )
}

function TournamentBoardTab({ players, groupings, scores, courses, rounds }) {
  const sortedRounds = useMemo(
    () => [...rounds].sort((a, b) => a.round_number - b.round_number),
    [rounds]
  )
  const [view, setView] = useState('trip')

  // Per-player, per-round, per-hole stableford points
  const perHolePts = useMemo(() => {
    const result = {}
    for (const player of players) result[player.id] = {}

    for (const round of sortedRounds) {
      const course = courses.find((c) => c.round_number === round.round_number)
      if (!course) continue
      const holes = (course.holes || []).sort((a, b) => a.hole_number - b.hole_number)

      for (const g of groupings.filter((g) => g.round_id === round.id)) {
        const player = players.find((p) => p.id === g.player_id)
        if (!player) continue
        result[player.id][round.round_number] = result[player.id][round.round_number] || {}

        for (const hole of holes) {
          const s = scores.find(
            (sc) => sc.player_id === player.id && sc.hole_number === hole.hole_number && sc.round_id === round.id
          )
          if (!s || s.gross_strokes === null) continue
          const esi = effectiveStrokeIndex(hole.stroke_index, holes)
          const pts = stablefordPoints(
            netScore(s.gross_strokes, player.handicap || 0, esi, holes.length) - hole.par
          )
          result[player.id][round.round_number][hole.hole_number] = pts
        }
      }
    }
    return result
  }, [players, groupings, scores, courses, sortedRounds])

  const roundNum = view === 'trip' ? null : parseInt(view.replace('r', ''))
  const roundCourse = roundNum ? courses.find((c) => c.round_number === roundNum) : null
  const roundHoles = useMemo(
    () => (roundCourse?.holes || []).sort((a, b) => a.hole_number - b.hole_number),
    [roundCourse]
  )
  const hasPrior = roundNum != null && sortedRounds.some((r) => r.round_number < roundNum)

  const rows = useMemo(() => {
    return players
      .map((player) => {
        const roundTotals = {}
        for (const r of sortedRounds) {
          roundTotals[r.round_number] = Object.values(
            perHolePts[player.id]?.[r.round_number] || {}
          ).reduce((s, v) => s + v, 0)
        }
        const tripTotal = Object.values(roundTotals).reduce((s, v) => s + v, 0)

        const priorPts = hasPrior
          ? sortedRounds
              .filter((r) => r.round_number < roundNum)
              .reduce((sum, r) => sum + (roundTotals[r.round_number] || 0), 0)
          : 0

        const holeMap = roundNum ? (perHolePts[player.id]?.[roundNum] || {}) : {}
        let cum = priorPts
        const cells = roundHoles.map((h) => {
          const pts = holeMap[h.hole_number]
          if (pts !== undefined) { cum += pts; return { cum, pts, played: true } }
          return { cum: null, pts: null, played: false }
        })

        const displayTotal =
          view === 'trip' ? tripTotal : priorPts + (roundTotals[roundNum] || 0)

        return { player, roundTotals, tripTotal, priorPts, cells, displayTotal }
      })
      .filter((r) => r.tripTotal > 0)
      .sort((a, b) => b.displayTotal - a.displayTotal)
  }, [players, perHolePts, sortedRounds, view, roundNum, roundHoles, hasPrior])

  if (!rows.length) return <EmptyState message="Scores will appear here as players complete holes." />

  const totalPar = roundHoles.reduce((s, h) => s + (h.par || 0), 0)

  const ViewToggle = () => (
    <div className="bg-gray-900 border-b border-gray-800 flex gap-1.5 px-3 py-2.5 overflow-x-auto no-scrollbar">
      {[{ id: 'trip', label: 'Trip' }, ...sortedRounds.map((r) => ({ id: `r${r.round_number}`, label: `Round ${r.round_number}` }))].map((opt) => (
        <button
          key={opt.id}
          onClick={() => setView(opt.id)}
          className={`px-3 py-1 rounded-md text-xs font-semibold whitespace-nowrap transition-colors
            ${view === opt.id ? 'bg-green-700 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200'}`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )

  // ── Trip standings ──────────────────────────────────────────────────────
  if (view === 'trip') {
    return (
      <div>
        <ViewToggle />
        <div className="bg-green-950 border-b border-green-900 py-1.5 text-center">
          <span className="text-[10px] font-bold text-green-500 uppercase tracking-[0.18em]">
            Leaders · Stableford · Higher is Better
          </span>
        </div>
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-gray-800 border-b border-gray-700 text-[10px] text-gray-500 uppercase tracking-wide">
              <th className="px-3 py-2.5 text-center" style={{ width: 44 }}>Pos</th>
              <th className="px-3 py-2.5 text-left">Player</th>
              {sortedRounds.map((r) => (
                <th key={r.id} className="px-2 py-2.5 text-center" style={{ width: 44 }}>R{r.round_number}</th>
              ))}
              <th className="px-3 py-2.5 text-center" style={{ width: 52 }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={row.player.id} className={`border-b border-gray-800 ${i % 2 !== 0 ? 'bg-gray-800/20' : ''}`}>
                <td className="px-3 py-3 text-center"><PosBadge pos={i + 1} /></td>
                <td className="px-3 py-3 font-semibold text-white text-sm">{row.player.name}</td>
                {sortedRounds.map((r) => (
                  <td key={r.id} className="px-2 py-3 text-center text-sm">
                    <span className={row.roundTotals[r.round_number] > 0 ? 'text-red-400 font-medium' : 'text-gray-700'}>
                      {row.roundTotals[r.round_number] > 0 ? row.roundTotals[r.round_number] : '—'}
                    </span>
                  </td>
                ))}
                <td className="px-3 py-3 text-center">
                  <span className="text-red-400 font-bold text-lg">{row.tripTotal}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  // ── Round board (Masters style) ─────────────────────────────────────────
  return (
    <div>
      <ViewToggle />
      <div className="bg-green-950 border-b border-green-900 py-1.5 text-center">
        <span className="text-[10px] font-bold text-green-500 uppercase tracking-[0.18em]">
          Round {roundNum} · Running Stableford Total
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="border-collapse text-xs" style={{ minWidth: 'max-content' }}>
          <thead>
            {/* Hole numbers header */}
            <tr className="bg-gray-800 border-b border-gray-700 text-[10px] text-gray-500 uppercase">
              <th className="sticky left-0 z-20 bg-gray-800 text-center border-r border-gray-700 px-0 py-2.5" style={{ width: 30, minWidth: 30 }}>#</th>
              <th className="sticky z-20 bg-gray-800 text-left border-r border-gray-700 px-2 py-2.5" style={{ left: 30, width: 84, minWidth: 84 }}>Player</th>
              {hasPrior && (
                <th className="text-center border-r border-gray-700 px-1 py-2.5 text-gray-600" style={{ width: 36, minWidth: 36 }}>Prior</th>
              )}
              {roundHoles.map((h, i) => (
                <th
                  key={h.hole_number}
                  className={`text-center text-gray-300 font-bold px-0 py-2.5 ${i === 8 && roundHoles.length > 9 ? 'border-r border-gray-600' : ''}`}
                  style={{ width: 28, minWidth: 28 }}
                >
                  {h.hole_number}
                </th>
              ))}
              <th className="text-center text-gray-300 font-bold border-l border-gray-700 px-2 py-2.5" style={{ width: 36, minWidth: 36 }}>
                Tot
              </th>
            </tr>
            {/* Par row */}
            <tr className="bg-green-950 border-b border-green-900 text-[10px] text-green-500">
              <td className="sticky left-0 z-20 bg-green-950 border-r border-green-900 px-0 py-1.5" style={{ width: 30, minWidth: 30 }} />
              <td className="sticky z-20 bg-green-950 border-r border-green-900 px-2 py-1.5 font-bold" style={{ left: 30, width: 84, minWidth: 84 }}>PAR</td>
              {hasPrior && <td className="border-r border-green-900 px-1 py-1.5" style={{ width: 36 }} />}
              {roundHoles.map((h, i) => (
                <td
                  key={h.hole_number}
                  className={`text-center font-medium px-0 py-1.5 ${i === 8 && roundHoles.length > 9 ? 'border-r border-green-900' : ''}`}
                  style={{ width: 28 }}
                >
                  {h.par}
                </td>
              ))}
              <td className="text-center font-medium border-l border-green-900 px-2 py-1.5" style={{ width: 36 }}>{totalPar || ''}</td>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const bg = i % 2 === 0 ? '#111827' : '#161f2e'
              return (
                <tr key={row.player.id} className="border-b border-gray-800/50">
                  <td className="sticky left-0 z-10 text-center border-r border-gray-800 px-0 py-3" style={{ background: bg, width: 30, minWidth: 30 }}>
                    <PosBadge pos={i + 1} small />
                  </td>
                  <td
                    className="sticky z-10 border-r border-gray-800 px-2 py-3 font-bold text-white"
                    style={{ background: bg, left: 30, width: 84, minWidth: 84, maxWidth: 84 }}
                  >
                    <span className="block truncate uppercase text-[11px] tracking-wide">
                      {row.player.name}
                    </span>
                  </td>
                  {hasPrior && (
                    <td className="text-center border-r border-gray-800 px-1 py-3 text-gray-500" style={{ width: 36 }}>
                      {row.priorPts > 0 ? row.priorPts : '—'}
                    </td>
                  )}
                  {row.cells.map((cell, hi) => (
                    <td
                      key={hi}
                      className={`text-center px-0 py-3 ${hi === 8 && roundHoles.length > 9 ? 'border-r border-gray-700' : ''}`}
                      style={{ width: 28 }}
                    >
                      {cell.played
                        ? <span className="text-red-400 font-bold">{cell.cum}</span>
                        : <span className="text-gray-800">·</span>
                      }
                    </td>
                  ))}
                  <td className="text-center border-l border-gray-800 px-2 py-3" style={{ width: 36 }}>
                    <span className="text-red-400 font-bold">
                      {row.displayTotal > 0 ? row.displayTotal : '—'}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
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
          const esi = effectiveStrokeIndex(hole.stroke_index, holes)
          const net = netScore(s.gross_strokes, p.handicap || 0, esi, holes.length)
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
        <div key={pt.player.id} className="bg-gray-800 rounded-xl border border-gray-700 px-4 py-3 flex items-center gap-3">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold
            ${i === 0 ? 'bg-yellow-500/20 text-yellow-400' : i === 1 ? 'bg-gray-600 text-gray-300' : i === 2 ? 'bg-orange-500/20 text-orange-400' : 'bg-gray-700 text-gray-500'}`}>
            {i + 1}
          </div>
          <div className="flex-1">
            <div className="font-semibold text-sm text-white">{pt.player.name}</div>
            <div className="text-xs text-gray-400">
              {roundNumbers.map((r) => `R${r}: ${pt.rounds[r] ?? '—'}`).join(' · ')}
            </div>
          </div>
          <div className="text-xl font-bold text-green-400">{pt.total}</div>
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

    // Use actual hole numbers (e.g. 10-18 for back-9) so wolfHoles stored at those keys are found
    const holeNums = holes.length > 0
      ? holes.map((h) => h.hole_number)
      : Array.from({ length: holeCount }, (_, i) => i + 1)

    const groupNums = [...new Set(roundGroupings.map((g) => g.group_number))].sort((a, b) => a - b)
    for (const groupNum of groupNums) {
      const gPlayers = roundGroupings.filter((g) => g.group_number === groupNum).sort((a, b) => a.wolf_order - b.wolf_order)
      if (!gPlayers.length) continue

      gPlayers.forEach((g) => (deltas[g.player_id] = deltas[g.player_id] || 0))

      let carry = 0
      for (let hi = 0; hi < holeNums.length; hi++) {
        const hole = holeNums[hi]
        const isComebackHole = hi >= holeCount - 4
        const wh = wolfHoles.find((w) => w.hole_number === hole && w.group_number === groupNum)
        if (!wh || !wh.result) {
          carry = isComebackHole ? 0 : carry + (wh?.base_value || 1)
          continue
        }

        const effectiveVal = carry + wh.base_value
        const mult = MULTIPLIERS[wh.declaration] || 1
        const pot = effectiveVal * mult
        const ids = gPlayers.map((g) => g.player_id)

        holeLog.push({
          hole,
          groupNum,
          wolfId: wh.wolf_player_id,
          partnerId: wh.partner_player_id,
          throwerId: wh.declaration === DECLARATION.THREW ? wh.partner_player_id : null,
          declaration: wh.declaration,
          pot,
          result: wh.result,
          carry: carry > 0,
        })

        if (wh.result === 'push') { carry = isComebackHole ? 0 : carry + wh.base_value; continue }
        carry = 0

        // Additive model: winners each get +pot, losers stay at 0
        if (wh.declaration === DECLARATION.PARTNER) {
          const wolfTeam = [wh.wolf_player_id, wh.partner_player_id].filter(Boolean)
          const others = ids.filter((id) => !wolfTeam.includes(id))
          if (wh.result === 'wolf_win') {
            wolfTeam.forEach((id) => (deltas[id] += pot))
          } else {
            others.forEach((id) => (deltas[id] += pot))
          }
        } else if (wh.declaration === DECLARATION.THREW) {
          const throwerId = wh.partner_player_id
          const others = ids.filter((id) => id !== throwerId)
          if (wh.result === 'wolf_win') {
            if (throwerId) deltas[throwerId] += pot
          } else {
            others.forEach((id) => (deltas[id] += pot))
          }
        } else {
          const others = ids.filter((id) => id !== wh.wolf_player_id)
          if (wh.result === 'wolf_win') {
            deltas[wh.wolf_player_id] += pot
          } else {
            others.forEach((id) => (deltas[id] += pot))
          }
        }
      }
    }

    return { deltas, holeLog }
  }, [groupings, wolfHoles, holes, activeRoundId, holeCount])

  const sorted = Object.entries(deltas).sort((a, b) => b[1] - a[1])

  if (!sorted.length) return <EmptyState message="Wolf scores will appear as holes are played." />

  return (
    <div className="p-4 space-y-4">
      <div className="space-y-2">
        {sorted.map(([pid, pts], i) => {
          const p = players.find((pl) => pl.id === pid)
          return (
            <div key={pid} className="bg-gray-800 rounded-xl border border-gray-700 px-4 py-3 flex items-center gap-3">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold
                ${i === 0 ? 'bg-yellow-500/20 text-yellow-400' : 'bg-gray-700 text-gray-500'}`}>
                {i + 1}
              </div>
              <div className="flex-1 font-semibold text-sm text-white">{p?.name}</div>
              <div className={`text-lg font-bold ${pts > 0 ? 'text-green-600' : 'text-gray-400'}`}>
                {pts}
              </div>
            </div>
          )
        })}
      </div>

      {holeLog.length > 0 && (
        <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
          <div className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide bg-gray-700">
            Hole Log
          </div>
          <div className="divide-y divide-gray-700">
            {holeLog.map((entry, i) => {
              const wolf = players.find((p) => p.id === entry.wolfId)
              const thrower = entry.throwerId ? players.find((p) => p.id === entry.throwerId) : null
              return (
                <div key={i} className="px-4 py-2.5 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium">
                      H{entry.hole} — {thrower ? `${thrower.name} ⚡` : wolf?.name}
                      {entry.carry && <span className="text-xs text-orange-400 ml-1">(carry)</span>}
                    </div>
                    <div className="text-xs text-gray-400">
                      {declarationShort(entry.declaration)} · {entry.pot}pt
                    </div>
                  </div>
                  <div className={`text-sm font-semibold ${entry.result === 'wolf_win' ? 'text-green-400' : entry.result === 'wolf_lose' ? 'text-red-500' : 'text-gray-400'}`}>
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
  return { blind: 'Blind 4×', early: 'Lone 3×', late: 'Lone 2×', partner: 'Partner 1×', threw: 'Threw 2×' }[d] || d
}

// ── Orientation hook ────────────────────────────────────────────────────────

function useOrientation() {
  const [isLandscape, setIsLandscape] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(orientation: landscape)').matches
  )
  useEffect(() => {
    const mq = window.matchMedia('(orientation: landscape)')
    const handle = (e) => setIsLandscape(e.matches)
    mq.addEventListener('change', handle)
    return () => mq.removeEventListener('change', handle)
  }, [])
  return isLandscape
}

// ── Golf score cell (birdie=red circle, bogey=square, eagle=gold circle) ────

function GolfScore({ gross, par }) {
  if (gross == null) return <span className="text-gray-700 text-xs">·</span>
  const diff = par != null ? gross - par : null
  let ring = '', text = ''
  if (diff === null)    { text = 'text-gray-300' }
  else if (diff <= -2)  { ring = 'ring-2 ring-yellow-400 rounded-full'; text = 'text-yellow-300' }
  else if (diff === -1) { ring = 'ring-1 ring-red-500 rounded-full';    text = 'text-white' }
  else if (diff === 0)  { text = 'text-green-400' }
  else if (diff === 1)  { ring = 'ring-1 ring-gray-500 rounded-sm';     text = 'text-gray-300' }
  else                  { ring = 'ring-2 ring-red-700 rounded-sm';       text = 'text-red-400' }
  return (
    <span className={`inline-flex items-center justify-center w-6 h-6 text-xs font-bold ${ring} ${text}`}>
      {gross}
    </span>
  )
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
              <div key={pid} className="bg-gray-800 rounded-xl border border-gray-700 px-4 py-3 flex items-center gap-3">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold
                  ${i === 0 ? 'bg-yellow-500/20 text-yellow-400' : 'bg-gray-700 text-gray-500'}`}>
                  {i + 1}
                </div>
                <div className="flex-1 font-semibold text-sm text-white">{p?.name}</div>
                <div className="text-lg font-bold text-green-600">{val} skin{val !== 1 ? 's' : ''}</div>
              </div>
            )
          })}
        </div>
      )}

      <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
        <div className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide bg-gray-700 grid grid-cols-4">
          <span>Hole</span>
          <span className="text-center">Par</span>
          <span className="text-center">Value</span>
          <span className="text-right">Winner</span>
        </div>
        <div className="divide-y divide-gray-700">
          {skinResults.map((skin) => {
            const winner = skin.winnerId ? players.find((p) => p.id === skin.winnerId) : null
            return (
              <div key={skin.holeNumber} className="px-4 py-2.5 grid grid-cols-4 items-center">
                <span className="text-sm font-medium text-gray-300">{skin.holeNumber}</span>
                <span className="text-center text-sm text-gray-500">{holes.find((h) => h.hole_number === skin.holeNumber)?.par}</span>
                <span className={`text-center text-sm font-semibold ${skin.value > 1 ? 'text-orange-400' : 'text-gray-400'}`}>
                  {skin.value > 0 ? skin.value : '—'}
                </span>
                <span className="text-right text-sm">
                  {skin.pending ? <span className="text-gray-300 italic">pending</span>
                    : skin.push ? <span className="text-gray-400 italic">carry</span>
                    : winner ? <span className="font-medium text-green-400">{winner.name.split(' ')[0]}</span>
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
        <div key={nr.groupNumber} className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
          <div className={`px-4 py-2 text-sm font-semibold ${nr.groupNumber === 1 ? 'bg-green-900/40 text-green-400' : 'bg-blue-900/40 text-blue-400'}`}>
            Group {nr.groupNumber}
          </div>
          <div className="divide-y divide-gray-700">
            {/* Standings */}
            {Object.entries(nr.netTotals)
              .sort((a, b) => a[1].total - b[1].total)
              .map(([pid, totals]) => {
                const p = players.find((pl) => pl.id === pid)
                return (
                  <div key={pid} className="px-4 py-3 flex items-center justify-between">
                    <div className="font-medium text-sm text-white">{p?.name}</div>
                    <div className="flex gap-4 text-xs text-gray-500">
                      <span>F: {totals.front || '—'}</span>
                      <span>B: {totals.back || '—'}</span>
                      <span className="font-semibold text-gray-300">T: {totals.total || '—'}</span>
                    </div>
                  </div>
                )
              })}
          </div>
          <div className="px-4 py-2 bg-gray-700 border-t border-gray-600 grid grid-cols-3 text-xs text-center gap-2">
            {['front', 'back', 'overall'].map((seg) => {
              const winnerId = nr[`${seg}Winner`]
              const winner = winnerId ? players.find((p) => p.id === winnerId) : null
              return (
                <div key={seg}>
                  <div className="text-gray-400 capitalize">{seg}</div>
                  <div className="font-semibold text-white">{winner ? winner.name.split(' ')[0] : 'TBD'}</div>
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

// One half of the scorecard (front 9 or back 9)
function HalfCard({ players, holes, scores, activeRoundId, allHoles, label, showTot }) {
  const hasYards = holes.some((h) => h.yards)
  const hasPar   = holes.some((h) => h.par)
  const halfPar  = holes.reduce((s, h) => s + (h.par   || 0), 0)
  const halfYds  = holes.reduce((s, h) => s + (h.yards || 0), 0)
  const totalPar = allHoles.reduce((s, h) => s + (h.par || 0), 0)

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse" style={{ minWidth: 'min-content' }}>
        <thead>
          <tr className="bg-gray-700">
            <th className="text-left pl-3 pr-1 py-1.5 text-gray-400 font-semibold w-14">HOLE</th>
            {holes.map((h) => (
              <th key={h.hole_number} className="text-center px-0 py-1.5 text-gray-400 font-semibold w-7 min-w-[1.6rem]">
                {h.hole_number}
              </th>
            ))}
            <th className="text-center px-1.5 py-1.5 text-white font-bold border-l border-gray-600 w-9 min-w-9 bg-gray-600/50">
              {label === 'FRONT' ? 'OUT' : 'IN'}
            </th>
            {showTot && (
              <th className="text-center px-1.5 py-1.5 text-white font-bold border-l border-gray-600 w-9 min-w-9">TOT</th>
            )}
          </tr>

          {hasYards && (
            <tr className="bg-gray-900">
              <td className="pl-3 pr-1 py-0.5 text-blue-400 font-semibold">YDS</td>
              {holes.map((h) => (
                <td key={h.hole_number} className="text-center px-0 py-0.5 text-blue-300/80 leading-none">
                  {h.yards || ''}
                </td>
              ))}
              <td className="text-center px-1.5 py-0.5 text-blue-300 font-semibold border-l border-gray-700 bg-gray-800/40">
                {halfYds || ''}
              </td>
              {showTot && <td className="border-l border-gray-700" />}
            </tr>
          )}

          {hasPar && (
            <tr className="bg-gray-800/50">
              <td className="pl-3 pr-1 py-0.5 text-gray-500 font-semibold">PAR</td>
              {holes.map((h) => (
                <td key={h.hole_number} className="text-center px-0 py-0.5 text-gray-500">
                  {h.par || ''}
                </td>
              ))}
              <td className="text-center px-1.5 py-0.5 text-gray-400 font-semibold border-l border-gray-700 bg-gray-800/40">
                {halfPar || ''}
              </td>
              {showTot && (
                <td className="text-center px-1.5 py-0.5 text-gray-400 font-semibold border-l border-gray-700">
                  {totalPar || ''}
                </td>
              )}
            </tr>
          )}
        </thead>

        <tbody>
          {players.map((g, idx) => {
            const pScores = scores.filter((s) => s.round_id === activeRoundId && s.player_id === g.player_id)
            const halfGross = holes.reduce((sum, h) => {
              const s = pScores.find((sc) => sc.hole_number === h.hole_number)
              return s?.gross_strokes != null ? sum + s.gross_strokes : sum
            }, 0)
            const halfPlayed = holes.some((h) => pScores.find((sc) => sc.hole_number === h.hole_number)?.gross_strokes != null)
            const totGross = allHoles.reduce((sum, h) => {
              const s = pScores.find((sc) => sc.hole_number === h.hole_number)
              return s?.gross_strokes != null ? sum + s.gross_strokes : sum
            }, 0)
            const totPlayed = allHoles.some((h) => pScores.find((sc) => sc.hole_number === h.hole_number)?.gross_strokes != null)

            return (
              <tr key={g.player_id} className={`border-t border-gray-800 ${idx % 2 === 1 ? 'bg-gray-800/30' : ''}`}>
                <td className="pl-3 pr-1 py-2 font-bold text-gray-200 truncate max-w-[3.5rem]">
                  {g.player?.name?.split(' ')[0]}
                </td>
                {holes.map((h) => {
                  const s = pScores.find((sc) => sc.hole_number === h.hole_number)
                  return (
                    <td key={h.hole_number} className="text-center px-0 py-2">
                      <GolfScore gross={s?.gross_strokes} par={h.par} />
                    </td>
                  )
                })}
                <td className="text-center px-1.5 py-2 font-bold text-white border-l border-gray-700 bg-gray-800/20">
                  {halfPlayed ? halfGross : '—'}
                </td>
                {showTot && (
                  <td className="text-center px-1.5 py-2 font-bold text-green-400 border-l border-gray-700">
                    {totPlayed ? totGross : '—'}
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// Full 18-hole card shown in landscape
function FullCard({ players, frontHoles, backHoles, scores, activeRoundId, hasPar, hasYards }) {
  const frontPar = frontHoles.reduce((s, h) => s + (h.par   || 0), 0)
  const backPar  = backHoles.reduce( (s, h) => s + (h.par   || 0), 0)
  const frontYds = frontHoles.reduce((s, h) => s + (h.yards || 0), 0)
  const backYds  = backHoles.reduce( (s, h) => s + (h.yards || 0), 0)

  return (
    <div className="overflow-x-auto">
      <table className="text-xs border-collapse" style={{ minWidth: 'max-content' }}>
        <thead>
          <tr className="bg-gray-700">
            <th className="text-left pl-3 pr-2 py-1.5 text-gray-400 font-semibold w-16">HOLE</th>
            {frontHoles.map((h) => (
              <th key={h.hole_number} className="text-center px-1 py-1.5 text-gray-400 font-semibold w-8">{h.hole_number}</th>
            ))}
            <th className="text-center px-2 py-1.5 text-white font-bold border-x border-gray-500 w-10 bg-gray-600/50">OUT</th>
            {backHoles.map((h) => (
              <th key={h.hole_number} className="text-center px-1 py-1.5 text-gray-400 font-semibold w-8">{h.hole_number}</th>
            ))}
            <th className="text-center px-2 py-1.5 text-white font-bold border-x border-gray-500 w-10 bg-gray-600/50">IN</th>
            <th className="text-center px-2 py-1.5 text-white font-bold w-10">TOT</th>
          </tr>

          {hasYards && (
            <tr className="bg-gray-900">
              <td className="pl-3 pr-2 py-0.5 text-blue-400 font-semibold">YDS</td>
              {frontHoles.map((h) => <td key={h.hole_number} className="text-center px-1 py-0.5 text-blue-300/80">{h.yards || ''}</td>)}
              <td className="text-center px-2 py-0.5 text-blue-300 font-semibold border-x border-gray-700 bg-gray-800/50">{frontYds || ''}</td>
              {backHoles.map((h) => <td key={h.hole_number} className="text-center px-1 py-0.5 text-blue-300/80">{h.yards || ''}</td>)}
              <td className="text-center px-2 py-0.5 text-blue-300 font-semibold border-x border-gray-700 bg-gray-800/50">{backYds || ''}</td>
              <td className="text-center px-2 py-0.5 text-blue-300 font-semibold">{(frontYds + backYds) || ''}</td>
            </tr>
          )}

          {hasPar && (
            <tr className="bg-gray-800/50">
              <td className="pl-3 pr-2 py-0.5 text-gray-500 font-semibold">PAR</td>
              {frontHoles.map((h) => <td key={h.hole_number} className="text-center px-1 py-0.5 text-gray-500">{h.par || ''}</td>)}
              <td className="text-center px-2 py-0.5 text-gray-400 font-semibold border-x border-gray-700 bg-gray-800/40">{frontPar || ''}</td>
              {backHoles.map((h) => <td key={h.hole_number} className="text-center px-1 py-0.5 text-gray-500">{h.par || ''}</td>)}
              <td className="text-center px-2 py-0.5 text-gray-400 font-semibold border-x border-gray-700 bg-gray-800/40">{backPar || ''}</td>
              <td className="text-center px-2 py-0.5 text-gray-400 font-semibold">{(frontPar + backPar) || ''}</td>
            </tr>
          )}
        </thead>

        <tbody>
          {players.map((g, idx) => {
            const pScores = scores.filter((s) => s.round_id === activeRoundId && s.player_id === g.player_id)
            const halfScore = (hls) => hls.reduce((sum, h) => {
              const s = pScores.find((sc) => sc.hole_number === h.hole_number)
              return s?.gross_strokes != null ? sum + s.gross_strokes : sum
            }, 0)
            const halfPlayed = (hls) => hls.some((h) => pScores.find((sc) => sc.hole_number === h.hole_number)?.gross_strokes != null)
            const out = halfScore(frontHoles)
            const inn = halfScore(backHoles)
            const outPlayed = halfPlayed(frontHoles)
            const inPlayed  = halfPlayed(backHoles)

            return (
              <tr key={g.player_id} className={`border-t border-gray-800 ${idx % 2 === 1 ? 'bg-gray-800/30' : ''}`}>
                <td className="pl-3 pr-2 py-2 font-bold text-gray-200 whitespace-nowrap">{g.player?.name?.split(' ')[0]}</td>
                {frontHoles.map((h) => {
                  const s = pScores.find((sc) => sc.hole_number === h.hole_number)
                  return <td key={h.hole_number} className="text-center px-1 py-2"><GolfScore gross={s?.gross_strokes} par={h.par} /></td>
                })}
                <td className="text-center px-2 py-2 font-bold text-white border-x border-gray-700 bg-gray-800/20">{outPlayed ? out : '—'}</td>
                {backHoles.map((h) => {
                  const s = pScores.find((sc) => sc.hole_number === h.hole_number)
                  return <td key={h.hole_number} className="text-center px-1 py-2"><GolfScore gross={s?.gross_strokes} par={h.par} /></td>
                })}
                <td className="text-center px-2 py-2 font-bold text-white border-x border-gray-700 bg-gray-800/20">{inPlayed ? inn : '—'}</td>
                <td className="text-center px-2 py-2 font-bold text-green-400">{(outPlayed || inPlayed) ? out + inn : '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function ScorecardTab({ players, groupings, scores, holes, activeRoundId }) {
  const isLandscape = useOrientation()

  const roundGroupings = groupings
    .filter((g) => g.round_id === activeRoundId)
    .sort((a, b) => a.group_number - b.group_number || a.wolf_order - b.wolf_order)
    .map((g) => ({ ...g, player: players.find((p) => p.id === g.player_id) }))

  if (!roundGroupings.length) return <EmptyState message="No scorecard data yet." />

  const sortedHoles = [...holes].sort((a, b) => a.hole_number - b.hole_number)
  const hasCourse = sortedHoles.length > 0
  const hasPar    = sortedHoles.some((h) => h.par)
  const hasYards  = sortedHoles.some((h) => h.yards)

  // If no course scanned, generate placeholder holes from scored holes
  const maxHole = hasCourse
    ? sortedHoles[sortedHoles.length - 1].hole_number
    : scores.filter((s) => s.round_id === activeRoundId).reduce((m, s) => Math.max(m, s.hole_number), 18)
  const displayHoles = hasCourse
    ? sortedHoles
    : Array.from({ length: maxHole }, (_, i) => ({ hole_number: i + 1, par: null, yards: null }))

  const is18       = displayHoles.length >= 18
  const frontHoles = is18 ? displayHoles.filter((h) => h.hole_number <= 9)  : displayHoles
  const backHoles  = is18 ? displayHoles.filter((h) => h.hole_number > 9)   : []
  const groups     = [...new Set(roundGroupings.map((g) => g.group_number))].sort((a, b) => a - b)

  return (
    <div className="pb-8">
      {!hasPar && (
        <p className="text-xs text-gray-500 text-center py-2 px-4">Scan a scorecard to show par and yardages</p>
      )}

      {isLandscape && is18 ? (
        // Landscape: classic full 18-hole card
        <div className="px-2 pt-2">
          {groups.map((groupNum) => (
            <div key={groupNum} className="mb-4">
              <div className={`px-2 pb-1 text-xs font-bold uppercase tracking-widest ${groupNum === 1 ? 'text-green-400' : 'text-blue-400'}`}>
                Group {groupNum}
              </div>
              <FullCard
                players={roundGroupings.filter((g) => g.group_number === groupNum)}
                frontHoles={frontHoles}
                backHoles={backHoles}
                scores={scores}
                activeRoundId={activeRoundId}
                hasPar={hasPar}
                hasYards={hasYards}
              />
            </div>
          ))}
        </div>
      ) : (
        // Portrait: stacked front / back halves
        <div className="pt-1">
          {groups.map((groupNum) => {
            const gPlayers = roundGroupings.filter((g) => g.group_number === groupNum)
            return (
              <div key={groupNum} className="mb-5">
                <div className={`px-4 py-1 text-xs font-bold uppercase tracking-widest ${groupNum === 1 ? 'text-green-400' : 'text-blue-400'}`}>
                  Group {groupNum}
                </div>
                <HalfCard
                  players={gPlayers}
                  holes={frontHoles}
                  scores={scores}
                  activeRoundId={activeRoundId}
                  allHoles={displayHoles}
                  label="FRONT"
                  showTot={!is18}
                />
                {is18 && (
                  <HalfCard
                    players={gPlayers}
                    holes={backHoles}
                    scores={scores}
                    activeRoundId={activeRoundId}
                    allHoles={displayHoles}
                    label="BACK"
                    showTot={true}
                  />
                )}
              </div>
            )
          })}
          {is18 && (
            <p className="text-xs text-gray-600 text-center pb-2">↺ Rotate to landscape for full 18-hole view</p>
          )}
        </div>
      )}
    </div>
  )
}

function EmptyState({ message }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center px-6">
      <div className="text-4xl mb-3">⛳</div>
      <p className="text-gray-400 text-sm">{message}</p>
    </div>
  )
}

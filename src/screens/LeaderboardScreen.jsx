import { useMemo, useState, useEffect, useRef } from 'react'
import { useApp } from '../context/AppContext'
import {
  netScore, strokesReceived, effectiveStrokeIndex,
  MULTIPLIERS, DECLARATION,
  calcSkins, skinsTotals, calcDailySkins,
  calcTripNet, calcSimpleDayNet, calcFridayNet,
  calcPot,
} from '../lib/gameEngine'
import TabBar from '../components/TabBar'
import BottomNav from '../components/BottomNav'
import SettlementScreen from './SettlementScreen'

const DAY_LABELS = ['Thursday', 'Friday', 'Saturday']

const TABS = [
  { id: 'trip',     label: 'Trip Net' },
  { id: 'today',    label: 'Today' },
  { id: 'thursday', label: 'Thu' },
  { id: 'friday',   label: 'Fri' },
  { id: 'saturday', label: 'Sat' },
  { id: 'skins',    label: 'Skins' },
  { id: 'wolf',     label: 'Wolf' },
  { id: 'money',    label: 'Money' },
]

export default function LeaderboardScreen({ setScreen }) {
  const { state } = useApp()
  const { players, groupings, scores, wolfHoles, chipOffs, courses, rounds, activeRoundId, trip } = state
  const [tab, setTab] = useState('trip')

  // viewRoundId for Wolf/Skins/Scorecard tabs
  const [viewRoundId, setViewRoundId] = useState(activeRoundId)
  const prevActiveRef = useRef(activeRoundId)
  useEffect(() => {
    if (activeRoundId !== prevActiveRef.current) {
      if (viewRoundId === prevActiveRef.current || !viewRoundId) setViewRoundId(activeRoundId)
      prevActiveRef.current = activeRoundId
    }
  }, [activeRoundId, viewRoundId])

  const sortedRounds = useMemo(() => [...rounds].sort((a, b) => a.round_number - b.round_number), [rounds])

  // Detect "today" by matching current date to rounds' date field
  const todayStr = new Date().toISOString().split('T')[0]
  const todayLabel = useMemo(() => {
    const r = sortedRounds.find((r) => r.date === todayStr && r.day_label)
    return r?.day_label || null
  }, [sortedRounds, todayStr])

  // Pot amounts
  const pot = useMemo(() => {
    const buyIn = trip?.buy_in || 0
    const n = players.length || 8
    return buyIn > 0 ? calcPot(buyIn, n) : null
  }, [trip, players])

  // Rounds by day label
  const roundsByDay = useMemo(() => {
    const map = {}
    for (const dl of DAY_LABELS) {
      map[dl] = sortedRounds.filter((r) => r.day_label === dl)
    }
    return map
  }, [sortedRounds])

  // View round details for Wolf/Skins tabs
  const viewRound = rounds.find((r) => r.id === viewRoundId)
  const viewCourse = courses.find((c) => c.round_number === viewRound?.round_number)
  const viewHoles = useMemo(() => (viewCourse?.holes || []).sort((a, b) => a.hole_number - b.hole_number), [viewCourse])

  // Tab label override for Today
  const todayTabLabel = todayLabel ? `Today (${todayLabel.slice(0, 3)})` : 'Today'
  const tabs = TABS.map((t) => t.id === 'today' ? { ...t, label: todayTabLabel } : t)

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col max-w-md mx-auto">
      <header className="bg-gray-900 border-b border-gray-800 px-4 py-3 sticky top-0 z-40">
        <h1 className="text-base font-semibold text-white">Leaderboard</h1>
      </header>

      <TabBar tabs={tabs} active={tab} onChange={setTab} />

      {/* Round picker for Wolf/Skins tabs */}
      {tab === 'wolf' && rounds.length > 1 && (
        <RoundPicker rounds={rounds} courses={courses} viewRoundId={viewRoundId} activeRoundId={activeRoundId} onChange={setViewRoundId} />
      )}
      {tab === 'skins' && rounds.length > 1 && (
        <RoundPicker rounds={rounds} courses={courses} viewRoundId={viewRoundId} activeRoundId={activeRoundId} onChange={setViewRoundId} />
      )}

      <div className="flex-1 pb-24">
        {tab === 'trip' && (
          <TripNetTab players={players} groupings={groupings} scores={scores} courses={courses} rounds={sortedRounds} pot={pot} />
        )}
        {tab === 'today' && (
          <DayNetTab
            players={players} groupings={groupings} scores={scores} courses={courses}
            dayRounds={todayLabel ? roundsByDay[todayLabel] : []}
            dayLabel={todayLabel || 'Today'}
            isFriday={todayLabel === 'Friday'}
            potAmount={todayLabel === 'Friday' ? pot?.dailyNet : pot?.dailyNet}
          />
        )}
        {tab === 'thursday' && (
          <DayNetTab
            players={players} groupings={groupings} scores={scores} courses={courses}
            dayRounds={roundsByDay['Thursday']}
            dayLabel="Thursday"
            isFriday={false}
            potAmount={pot?.dailyNet}
          />
        )}
        {tab === 'friday' && (
          <DayNetTab
            players={players} groupings={groupings} scores={scores} courses={courses}
            dayRounds={roundsByDay['Friday']}
            dayLabel="Friday"
            isFriday={true}
            potAmount={pot?.dailyNet}
          />
        )}
        {tab === 'saturday' && (
          <DayNetTab
            players={players} groupings={groupings} scores={scores} courses={courses}
            dayRounds={roundsByDay['Saturday']}
            dayLabel="Saturday"
            isFriday={false}
            potAmount={pot?.dailyNet}
          />
        )}
        {tab === 'skins' && (
          <SkinsTab
            players={players} groupings={groupings} scores={scores} courses={courses}
            rounds={sortedRounds} roundsByDay={roundsByDay} chipOffs={chipOffs}
            viewRoundId={viewRoundId} pot={pot}
          />
        )}
        {tab === 'wolf' && (
          <WolfTab
            players={players} groupings={groupings} wolfHoles={wolfHoles}
            holes={viewHoles} activeRoundId={viewRoundId}
          />
        )}
        {tab === 'money' && (
          <MoneyTab setScreen={setScreen} />
        )}
      </div>

      <BottomNav screen="leaderboard" setScreen={setScreen} />
    </div>
  )
}

// ── Round picker ───────────────────────────────────────────────────────────

function RoundPicker({ rounds, courses, viewRoundId, activeRoundId, onChange }) {
  const sorted = useMemo(() => [...rounds].sort((a, b) => a.round_number - b.round_number), [rounds])
  return (
    <div className="bg-gray-900 border-b border-gray-800 flex gap-1.5 px-3 py-2 overflow-x-auto no-scrollbar">
      {sorted.map((r) => {
        const course = courses.find((c) => c.round_number === r.round_number)
        const isActive = r.id === activeRoundId
        const isViewing = r.id === viewRoundId
        return (
          <button
            key={r.id}
            onClick={() => onChange(r.id)}
            className={`flex-shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors
              ${isViewing ? 'bg-green-700 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200'}`}
          >
            R{r.round_number}
            {r.day_label && <span className={`text-[10px] ${isViewing ? 'text-green-300' : 'text-gray-600'}`}>· {r.day_label.slice(0, 3)}</span>}
            {isActive && <span className="text-[10px] text-yellow-400">●</span>}
          </button>
        )
      })}
    </div>
  )
}

// ── Shared helpers ─────────────────────────────────────────────────────────

function fmtNet(n) {
  if (n == null) return '—'
  if (n === 0) return 'E'
  return n > 0 ? `+${n}` : String(n)
}
function netColor(n) {
  if (n == null) return 'text-gray-500'
  if (n < 0) return 'text-red-500'
  if (n === 0) return 'text-gray-400'
  return 'text-gray-300'
}

function PlayerRow({ rank, name, score, label, highlight }) {
  return (
    <div className={`bg-gray-800 rounded-xl border px-4 py-3 flex items-center gap-3 ${highlight ? 'border-green-700' : 'border-gray-700'}`}>
      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0
        ${rank === 1 ? 'bg-yellow-500/20 text-yellow-400' : rank === 2 ? 'bg-gray-600 text-gray-300' : rank === 3 ? 'bg-orange-500/20 text-orange-400' : 'bg-gray-700 text-gray-500'}`}>
        {rank}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-sm text-white truncate">{name}</div>
        {label && <div className="text-xs text-gray-500">{label}</div>}
      </div>
      <div className={`text-xl font-black ${netColor(score)}`}>{fmtNet(score)}</div>
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

function PotBanner({ label, amount }) {
  if (!amount) return null
  return (
    <div className="mx-4 mt-4 bg-green-900/30 border border-green-800 rounded-xl px-4 py-2.5 text-center">
      <span className="text-sm font-bold text-green-300">{label}</span>
      <span className="text-green-400 font-black ml-2">${amount.toFixed(0)}</span>
    </div>
  )
}

// ── Trip Net Champion tab ──────────────────────────────────────────────────

function TripNetTab({ players, groupings, scores, courses, rounds, pot }) {
  const totals = useMemo(
    () => calcTripNet(scores, groupings, courses, rounds, players),
    [scores, groupings, courses, rounds, players]
  )

  const rows = useMemo(() =>
    Object.entries(totals)
      .map(([pid, net]) => ({ player: players.find((p) => p.id === pid), net }))
      .filter((r) => r.player)
      .sort((a, b) => a.net - b.net),
    [totals, players]
  )

  if (!rows.length) return <EmptyState message="Scores will appear here as rounds are played." />

  return (
    <div>
      <PotBanner label="Trip Net Champion —" amount={pot?.tripChampion} />
      {pot?.tripChampion && (
        <p className="text-xs text-gray-600 text-center mt-1 mb-2">Paid Saturday night</p>
      )}
      <div className="p-4 space-y-2">
        {rows.map((row, i) => (
          <PlayerRow key={row.player.id} rank={i + 1} name={row.player.name} score={row.net}
            label={`Hdcp ${row.player.handicap || 0}`} />
        ))}
      </div>
      <p className="text-xs text-gray-600 text-center pb-4">Cumulative net strokes · All rounds · Lowest wins</p>
    </div>
  )
}

// ── Daily Net tab (Thu / Fri / Sat / Today) ────────────────────────────────

function DayNetTab({ players, groupings, scores, courses, dayRounds, dayLabel, isFriday, potAmount }) {
  const totals = useMemo(() => {
    if (!dayRounds.length) return {}
    return isFriday
      ? calcFridayNet(scores, groupings, courses, dayRounds, players)
      : calcSimpleDayNet(scores, groupings, courses, dayRounds, players)
  }, [scores, groupings, courses, dayRounds, players, isFriday])

  const rows = useMemo(() =>
    Object.entries(totals)
      .map(([pid, net]) => ({ player: players.find((p) => p.id === pid), net }))
      .filter((r) => r.player)
      .sort((a, b) => a.net - b.net),
    [totals, players]
  )

  if (!dayRounds.length) {
    return <EmptyState message={`No rounds tagged "${dayLabel}" yet.`} />
  }
  if (!rows.length) {
    return <EmptyState message="Scores will appear here as holes are played." />
  }

  const roundCount = dayRounds.length
  const subLabel = isFriday
    ? `${roundCount} round${roundCount !== 1 ? 's' : ''} · Best 2 count · Lowest net wins`
    : `${roundCount} round${roundCount !== 1 ? 's' : ''} · Sum of net scores · Lowest wins`

  return (
    <div>
      <PotBanner label={`${dayLabel} Daily Net —`} amount={potAmount} />
      <div className="p-4 space-y-2">
        {rows.map((row, i) => (
          <PlayerRow key={row.player.id} rank={i + 1} name={row.player.name} score={row.net}
            label={`Hdcp ${row.player.handicap || 0}`} />
        ))}
      </div>
      <p className="text-xs text-gray-600 text-center pb-4">{subLabel}</p>
    </div>
  )
}

// ── Skins tab ──────────────────────────────────────────────────────────────

function SkinsTab({ players, groupings, scores, courses, rounds, roundsByDay, chipOffs, viewRoundId, pot }) {
  const [dayView, setDayView] = useState('round') // 'round' | 'Thursday' | 'Friday' | 'Saturday'

  const viewRound = rounds.find((r) => r.id === viewRoundId)

  // Per-round skins (current view round)
  const { singleResults, singleTotals } = useMemo(() => {
    const roundGroupings = groupings
      .filter((g) => g.round_id === viewRoundId)
      .map((g) => ({ ...g, player: players.find((p) => p.id === g.player_id) }))
    const course = courses.find((c) => c.round_number === viewRound?.round_number)
    const holes = (course?.holes || []).sort((a, b) => a.hole_number - b.hole_number)
    if (!roundGroupings.length || !holes.length) return { singleResults: [], singleTotals: {} }
    const singleResults = calcSkins(scores.filter((s) => s.round_id === viewRoundId), roundGroupings, holes, 1)
    return { singleResults, singleTotals: skinsTotals(singleResults) }
  }, [groupings, scores, courses, viewRoundId, viewRound, players])

  // Daily skins
  const { dailyResults, dailyTotals } = useMemo(() => {
    if (dayView === 'round') return { dailyResults: [], dailyTotals: {} }
    const dayRounds = roundsByDay[dayView] || []
    if (!dayRounds.length) return { dailyResults: [], dailyTotals: {} }
    const dailyResults = calcDailySkins(scores, groupings, courses, dayRounds, players, chipOffs, 1)
    return { dailyResults, dailyTotals: skinsTotals(dailyResults) }
  }, [dayView, roundsByDay, scores, groupings, courses, players, chipOffs])

  const results = dayView === 'round' ? singleResults : dailyResults
  const totals = dayView === 'round' ? singleTotals : dailyTotals
  const sortedPlayers = Object.entries(totals).sort((a, b) => b[1] - a[1])

  const potAmount = pot?.skinsDay

  return (
    <div className="pb-8">
      {/* Day / round toggle */}
      <div className="flex gap-1.5 px-3 py-2 bg-gray-900 border-b border-gray-800 overflow-x-auto no-scrollbar">
        {[
          { id: 'round', label: `R${viewRound?.round_number || '?'}` },
          ...DAY_LABELS.filter((dl) => (roundsByDay[dl] || []).length > 0).map((dl) => ({ id: dl, label: dl.slice(0, 3) })),
        ].map((opt) => (
          <button
            key={opt.id}
            onClick={() => setDayView(opt.id)}
            className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors
              ${dayView === opt.id ? 'bg-green-700 text-white' : 'bg-gray-800 text-gray-400'}`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {dayView !== 'round' && potAmount && (
        <div className="mx-4 mt-3 bg-orange-900/20 border border-orange-800/50 rounded-xl px-4 py-2 text-center">
          <span className="text-xs text-orange-300 font-semibold">{dayView} Skins Pot — </span>
          <span className="text-orange-400 font-black">${potAmount.toFixed(0)}</span>
        </div>
      )}

      <div className="p-4 space-y-4">
        {sortedPlayers.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-gray-500 text-center mb-1">Full field · Net score · Carries on ties</p>
            {sortedPlayers.map(([pid, val], i) => {
              const p = players.find((pl) => pl.id === pid)
              return (
                <div key={pid} className="bg-gray-800 rounded-xl border border-gray-700 px-4 py-3 flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold
                    ${i === 0 ? 'bg-yellow-500/20 text-yellow-400' : 'bg-gray-700 text-gray-500'}`}>
                    {i + 1}
                  </div>
                  <div className="flex-1 font-semibold text-sm text-white">{p?.name}</div>
                  <div className="text-lg font-bold text-green-500">{val} skin{val !== 1 ? 's' : ''}</div>
                </div>
              )
            })}
          </div>
        )}

        {/* Hole-by-hole */}
        <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
          <div className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide bg-gray-700 grid grid-cols-4">
            <span>Hole</span><span className="text-center">Par</span>
            <span className="text-center">Value</span><span className="text-right">Winner</span>
          </div>
          <div className="divide-y divide-gray-700 max-h-80 overflow-y-auto">
            {results.map((skin, i) => {
              const winner = skin.winnerId ? players.find((p) => p.id === skin.winnerId) : null
              const holeLabel = skin.chipOff ? 'C/O' : (skin.holeNumber === 'CO' ? 'C/O' : skin.holeNumber)
              const course = dayView === 'round'
                ? courses.find((c) => c.round_number === viewRound?.round_number)
                : null
              const holeData = course?.holes?.find((h) => h.hole_number === skin.holeNumber)
              return (
                <div key={i} className="px-4 py-2.5 grid grid-cols-4 items-center">
                  <span className={`text-sm font-medium ${skin.chipOff ? 'text-yellow-400' : 'text-gray-300'}`}>{holeLabel}</span>
                  <span className="text-center text-sm text-gray-500">{holeData?.par || '—'}</span>
                  <span className={`text-center text-sm font-semibold ${skin.value > 1 ? 'text-orange-400' : 'text-gray-400'}`}>
                    {skin.value > 0 ? skin.value : '—'}
                  </span>
                  <span className="text-right text-sm">
                    {skin.pending ? <span className="text-gray-400 italic">pending</span>
                      : skin.push ? <span className="text-gray-500 italic">carry</span>
                      : skin.chipOff ? <span className="text-yellow-400 font-medium">🏆 {winner?.name?.split(' ')[0]}</span>
                      : winner ? <span className="font-medium text-green-400">{winner.name.split(' ')[0]}</span>
                      : '—'}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Wolf tab ───────────────────────────────────────────────────────────────

function WolfTab({ players, groupings, wolfHoles, holes, activeRoundId }) {
  const holeCount = holes.length || 18
  const { deltas, holeLog } = useMemo(() => {
    const roundGroupings = groupings.filter((g) => g.round_id === activeRoundId)
    const deltas = {}
    const holeLog = []
    const holeNums = holes.length > 0 ? holes.map((h) => h.hole_number) : Array.from({ length: holeCount }, (_, i) => i + 1)
    const groupNums = [...new Set(roundGroupings.map((g) => g.group_number))].sort((a, b) => a - b)

    for (const groupNum of groupNums) {
      const gPlayers = roundGroupings.filter((g) => g.group_number === groupNum).sort((a, b) => a.wolf_order - b.wolf_order)
      if (!gPlayers.length) continue
      gPlayers.forEach((g) => (deltas[g.player_id] = deltas[g.player_id] || 0))

      let carry = 0
      for (let hi = 0; hi < holeNums.length; hi++) {
        const hole = holeNums[hi]
        const isComebackHole = hi >= holeCount - 3
        const wh = wolfHoles.find((w) => w.hole_number === hole && w.group_number === groupNum && w.round_id === activeRoundId)
        if (!wh || !wh.result) { carry = isComebackHole ? 0 : carry + (wh?.base_value || 1); continue }

        const effectiveVal = carry + wh.base_value
        const pot = effectiveVal * (MULTIPLIERS[wh.declaration] || 1)
        const ids = gPlayers.map((g) => g.player_id)

        holeLog.push({ hole, groupNum, wolfId: wh.wolf_player_id, partnerId: wh.partner_player_id,
          throwerId: wh.declaration === DECLARATION.THREW ? wh.partner_player_id : null,
          declaration: wh.declaration, pot, result: wh.result, carry: carry > 0 })

        if (wh.result === 'push') { carry = isComebackHole ? 0 : carry + wh.base_value; continue }
        carry = 0

        if (wh.declaration === DECLARATION.PARTNER) {
          const wolfTeam = [wh.wolf_player_id, wh.partner_player_id].filter(Boolean)
          const others = ids.filter((id) => !wolfTeam.includes(id))
          if (wh.result === 'wolf_win') wolfTeam.forEach((id) => (deltas[id] += pot))
          else others.forEach((id) => (deltas[id] += pot))
        } else if (wh.declaration === DECLARATION.THREW) {
          const throwerId = wh.partner_player_id
          const others = ids.filter((id) => id !== throwerId)
          if (wh.result === 'wolf_win') { if (throwerId) deltas[throwerId] += pot }
          else others.forEach((id) => (deltas[id] += pot))
        } else {
          const others = ids.filter((id) => id !== wh.wolf_player_id)
          if (wh.result === 'wolf_win') deltas[wh.wolf_player_id] += pot
          else others.forEach((id) => (deltas[id] += pot))
        }
      }
    }
    return { deltas, holeLog }
  }, [groupings, wolfHoles, holes, activeRoundId, holeCount])

  const roundGroupings = groupings.filter((g) => g.round_id === activeRoundId)
  const groupNums = [...new Set(roundGroupings.map((g) => g.group_number))].sort((a, b) => a - b)

  if (!Object.keys(deltas).length) return <EmptyState message="Wolf scores will appear as holes are played." />

  const GROUP_COLORS = ['text-green-400', 'text-blue-400', 'text-purple-400', 'text-orange-400']

  return (
    <div className="p-4 space-y-5">
      {groupNums.map((groupNum) => {
        const groupPlayers = roundGroupings
          .filter((g) => g.group_number === groupNum)
          .sort((a, b) => (deltas[b.player_id] || 0) - (deltas[a.player_id] || 0))
        const groupLog = holeLog.filter((e) => e.groupNum === groupNum)
        const colorText = GROUP_COLORS[(groupNum - 1) % GROUP_COLORS.length]

        return (
          <div key={groupNum} className="space-y-2">
            <p className={`text-xs font-bold uppercase tracking-widest px-1 ${colorText}`}>Group {groupNum} — Wolf Standings</p>
            <div className="space-y-2">
              {groupPlayers.map((g, i) => {
                const p = players.find((pl) => pl.id === g.player_id)
                const pts = deltas[g.player_id] || 0
                return (
                  <div key={g.player_id} className="bg-gray-800 rounded-xl border border-gray-700 px-4 py-3 flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold
                      ${i === 0 ? 'bg-yellow-500/20 text-yellow-400' : 'bg-gray-700 text-gray-500'}`}>{i + 1}</div>
                    <div className="flex-1 font-semibold text-sm text-white">{p?.name}</div>
                    <div className={`text-lg font-bold ${pts > 0 ? 'text-green-500' : 'text-gray-400'}`}>{pts}</div>
                  </div>
                )
              })}
            </div>
            {groupLog.length > 0 && (
              <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
                <div className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide bg-gray-700">Hole Log</div>
                <div className="divide-y divide-gray-700">
                  {groupLog.map((entry, i) => {
                    const wolf = players.find((p) => p.id === entry.wolfId)
                    const thrower = entry.throwerId ? players.find((p) => p.id === entry.throwerId) : null
                    const declLabel = { blind: 'Blind 4×', early: 'Lone 3×', late: 'Lone 2×', partner: 'Partner 1×', threw: 'Threw 2×' }[entry.declaration] || entry.declaration
                    return (
                      <div key={i} className="px-4 py-2.5 flex items-center justify-between">
                        <div>
                          <div className="text-sm font-medium">
                            H{entry.hole} — {thrower ? `${thrower.name} ⚡` : wolf?.name}
                            {entry.carry && <span className="text-xs text-orange-400 ml-1">(carry)</span>}
                          </div>
                          <div className="text-xs text-gray-400">{declLabel} · {entry.pot}pt</div>
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
      })}
    </div>
  )
}

// ── Money tab (embeds settlement) ──────────────────────────────────────────

function MoneyTab({ setScreen }) {
  return (
    <div className="pb-0">
      <SettlementScreen setScreen={setScreen} embedded />
    </div>
  )
}

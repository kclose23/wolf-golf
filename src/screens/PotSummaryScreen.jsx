import { useMemo } from 'react'
import { useApp } from '../context/AppContext'
import { calcPot, calcTripNet, calcSimpleDayNet, calcFridayNet, skinsTotals, calcDailySkins } from '../lib/gameEngine'
import BottomNav from '../components/BottomNav'

const DAY_LABELS = ['Thursday', 'Friday', 'Saturday']

export default function PotSummaryScreen({ setScreen }) {
  const { state } = useApp()
  const { players, groupings, scores, wolfHoles, chipOffs, courses, rounds, trip } = state

  const sortedRounds = useMemo(() => [...rounds].sort((a, b) => a.round_number - b.round_number), [rounds])

  const pot = useMemo(() => {
    const buyIn = trip?.buy_in || 0
    const n = players.length || 8
    return buyIn > 0 ? calcPot(buyIn, n) : null
  }, [trip, players])

  const roundsByDay = useMemo(() => {
    const map = {}
    for (const dl of DAY_LABELS) map[dl] = sortedRounds.filter((r) => r.day_label === dl)
    return map
  }, [sortedRounds])

  // Trip net leader
  const tripNetLeader = useMemo(() => {
    const totals = calcTripNet(scores, groupings, courses, sortedRounds, players)
    const best = Object.entries(totals).sort((a, b) => a[1] - b[1])[0]
    if (!best) return null
    const p = players.find((pl) => pl.id === best[0])
    return p ? { name: p.name, score: best[1] } : null
  }, [scores, groupings, courses, sortedRounds, players])

  // Daily net leaders
  const dailyLeaders = useMemo(() => {
    const result = {}
    for (const dl of DAY_LABELS) {
      const dayRounds = roundsByDay[dl]
      if (!dayRounds.length) continue
      const totals = dl === 'Friday'
        ? calcFridayNet(scores, groupings, courses, dayRounds, players)
        : calcSimpleDayNet(scores, groupings, courses, dayRounds, players)
      const best = Object.entries(totals).sort((a, b) => a[1] - b[1])[0]
      if (!best) continue
      const p = players.find((pl) => pl.id === best[0])
      if (p) result[dl] = { name: p.name, score: best[1] }
    }
    return result
  }, [scores, groupings, courses, roundsByDay, players])

  // Skins leaders per day
  const skinsLeaders = useMemo(() => {
    const result = {}
    for (const dl of DAY_LABELS) {
      const dayRounds = roundsByDay[dl]
      if (!dayRounds.length) continue
      const skinResults = calcDailySkins(scores, groupings, courses, dayRounds, players, chipOffs, 1)
      const totals = skinsTotals(skinResults)
      const best = Object.entries(totals).sort((a, b) => b[1] - a[1])[0]
      if (!best) continue
      const p = players.find((pl) => pl.id === best[0])
      if (p) result[dl] = { name: p.name, skins: best[1] }
    }
    return result
  }, [scores, groupings, courses, roundsByDay, players, chipOffs])

  if (!pot) {
    return (
      <div className="min-h-screen bg-gray-900 flex flex-col max-w-md mx-auto">
        <header className="bg-gray-900 border-b border-gray-800 px-4 py-3">
          <h1 className="text-base font-semibold text-white">Pot Summary</h1>
        </header>
        <div className="flex-1 flex items-center justify-center p-8 text-center">
          <div>
            <div className="text-4xl mb-3">💰</div>
            <p className="text-white font-semibold mb-1">No buy-in set</p>
            <p className="text-sm text-gray-500">Set a buy-in when creating the trip to see pot calculations.</p>
          </div>
        </div>
        <BottomNav screen="pot" setScreen={setScreen} />
      </div>
    )
  }

  const categories = [
    {
      id: 'trip',
      label: 'Trip Net Champion',
      amount: pot.tripChampion,
      sub: 'Paid Saturday night · Lowest cumulative net',
      leader: tripNetLeader,
      leaderLabel: tripNetLeader ? `${tripNetLeader.score > 0 ? '+' : ''}${tripNetLeader.score} net` : null,
      color: 'border-yellow-700 bg-yellow-900/10',
      accent: 'text-yellow-400',
    },
    ...DAY_LABELS.map((dl) => ({
      id: `daily-${dl}`,
      label: `${dl} Daily Net`,
      amount: pot.dailyNet,
      sub: dl === 'Friday' ? 'Best 2 of 3 rounds count' : 'Sum of all rounds',
      leader: dailyLeaders[dl],
      leaderLabel: dailyLeaders[dl] ? `${dailyLeaders[dl].score > 0 ? '+' : ''}${dailyLeaders[dl].score} net` : null,
      color: 'border-blue-800 bg-blue-900/10',
      accent: 'text-blue-400',
      noRounds: !roundsByDay[dl].length,
    })),
    ...DAY_LABELS.map((dl) => ({
      id: `skins-${dl}`,
      label: `${dl} Skins`,
      amount: pot.skinsDay,
      sub: 'Full field · Net · Carries reset each day',
      leader: skinsLeaders[dl],
      leaderLabel: skinsLeaders[dl] ? `${skinsLeaders[dl].skins} skin${skinsLeaders[dl].skins !== 1 ? 's' : ''}` : null,
      color: 'border-orange-800 bg-orange-900/10',
      accent: 'text-orange-400',
      noRounds: !roundsByDay[dl].length,
    })),
    {
      id: 'wolf',
      label: 'Wolf',
      amount: null,
      sub: '$1/pt between group members · Settled per round',
      leader: null,
      leaderLabel: null,
      color: 'border-gray-700 bg-gray-800/40',
      accent: 'text-gray-400',
      separate: true,
    },
  ]

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col max-w-md mx-auto">
      <header className="bg-gray-900 border-b border-gray-800 px-4 py-3 sticky top-0 z-40">
        <h1 className="text-base font-semibold text-white">Pot Summary</h1>
        <p className="text-xs text-gray-500">
          {players.length} players × ${(trip?.buy_in || 0).toFixed(0)}/person = <span className="text-white font-semibold">${pot.total.toFixed(0)} total</span>
        </p>
      </header>

      <div className="flex-1 p-4 pb-28 space-y-3">
        {categories.map((cat) => (
          <div key={cat.id} className={`rounded-xl border p-4 ${cat.color}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className={`font-bold text-sm ${cat.separate ? 'text-gray-300' : 'text-white'}`}>{cat.label}</div>
                <div className="text-xs text-gray-500 mt-0.5">{cat.sub}</div>
              </div>
              {cat.amount != null && (
                <div className={`text-xl font-black shrink-0 ${cat.accent}`}>${cat.amount.toFixed(0)}</div>
              )}
              {cat.separate && (
                <div className="text-xs text-gray-500 shrink-0 mt-1">Separate</div>
              )}
            </div>

            {!cat.separate && (
              <div className="mt-3 flex items-center justify-between">
                {cat.noRounds ? (
                  <span className="text-xs text-gray-600 italic">No rounds scheduled yet</span>
                ) : cat.leader ? (
                  <>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-gray-500 uppercase tracking-wide">Leading</span>
                      <span className="text-sm font-semibold text-white">{cat.leader.name}</span>
                    </div>
                    <span className={`text-sm font-bold ${cat.accent}`}>{cat.leaderLabel}</span>
                  </>
                ) : (
                  <span className="text-xs text-gray-600 italic">In progress</span>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <BottomNav screen="pot" setScreen={setScreen} />
    </div>
  )
}

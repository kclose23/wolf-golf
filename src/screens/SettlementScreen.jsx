import { useMemo, useState } from 'react'
import { useApp } from '../context/AppContext'
import { markPayment, deletePayment } from '../lib/db'
import {
  MULTIPLIERS, DECLARATION, calcSkins, skinsTotals, strokesReceived, netScore,
} from '../lib/gameEngine'
import Layout from '../components/Layout'
import BottomNav from '../components/BottomNav'
import Spinner from '../components/Spinner'

const ALL_GAMES = ['Wolf', 'Skins']

export default function SettlementScreen({ setScreen, embedded = false }) {
  const { state, actions } = useApp()
  const { players, groupings, scores, wolfHoles, courses, rounds, payments, tripId, activeRoundId, playerId } = state

  const trip = state.trip
  const dollarPerPoint = trip?.dollar_per_point || 1

  // ── Game opt-in toggles (persisted per trip) ───────────────────────────
  const gamesKey = `wolf_golf_active_games_${tripId}`
  const [activeGames, setActiveGames] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(gamesKey))
      if (Array.isArray(saved)) return new Set(saved)
    } catch {}
    return new Set(ALL_GAMES) // default all on
  })

  function toggleGame(game) {
    setActiveGames((prev) => {
      const next = new Set(prev)
      next.has(game) ? next.delete(game) : next.add(game)
      localStorage.setItem(gamesKey, JSON.stringify([...next]))
      return next
    })
  }

  // ── Compute all debts ──────────────────────────────────────────────────

  const rawDebts = useMemo(() => {
    const debts = [] // { from, to, amount, game, gameType }

    // Wolf (per round, per group) — pairwise: each player pays each player above them the point difference
    for (const round of rounds) {
      const course = courses.find((c) => c.round_number === round.round_number)
      const holes = (course?.holes || []).sort((a, b) => a.hole_number - b.hole_number)
      const holeCount = holes.length || 18

      const groupNums = [...new Set(
        groupings.filter((g) => g.round_id === round.id).map((g) => g.group_number)
      )].sort((a, b) => a - b)

      for (const groupNum of groupNums) {
        const gGroupings = groupings.filter((g) => g.round_id === round.id && g.group_number === groupNum)
        if (!gGroupings.length) continue

        const gIds = gGroupings.map((g) => g.player_id)
        const gPoints = Object.fromEntries(gIds.map((id) => [id, 0]))
        const roundWolfHoles = wolfHoles.filter((w) => w.round_id === round.id && w.group_number === groupNum)
        let carry = 0

        for (let hi = 0; hi < holeCount; hi++) {
          const hole = holes.length > 0 ? (holes[hi]?.hole_number ?? hi + 1) : hi + 1
          const isComebackHole = hi >= holeCount - 3
          const wh = roundWolfHoles.find((w) => w.hole_number === hole)
          if (!wh || !wh.result) {
            carry = isComebackHole ? 0 : carry + (wh?.base_value || 1)
            continue
          }
          const effectiveVal = carry + wh.base_value
          const pot = effectiveVal * (MULTIPLIERS[wh.declaration] || 1)
          if (wh.result === 'push') { carry = isComebackHole ? 0 : carry + wh.base_value; continue }
          carry = 0

          // Additive model: winners get +pot each, losers get 0
          if (wh.declaration === DECLARATION.PARTNER) {
            const wolfTeam = [wh.wolf_player_id, wh.partner_player_id].filter(Boolean)
            const others = gIds.filter((id) => !wolfTeam.includes(id))
            const winners = wh.result === 'wolf_win' ? wolfTeam : others
            winners.forEach((id) => { if (id in gPoints) gPoints[id] += pot })
          } else if (wh.declaration === DECLARATION.THREW) {
            const throwerId = wh.partner_player_id
            const others = gIds.filter((id) => id !== throwerId)
            const winners = wh.result === 'wolf_win'
              ? (throwerId ? [throwerId] : [])
              : others
            winners.forEach((id) => { if (id in gPoints) gPoints[id] += pot })
          } else {
            const winners = wh.result === 'wolf_win'
              ? [wh.wolf_player_id]
              : gIds.filter((id) => id !== wh.wolf_player_id)
            winners.forEach((id) => { if (id in gPoints) gPoints[id] += pot })
          }
        }

        // Each lower-point player pays each higher-point player the difference × dollar_per_point
        const ranked = Object.entries(gPoints).sort((a, b) => b[1] - a[1])
        for (let i = 0; i < ranked.length; i++) {
          for (let j = i + 1; j < ranked.length; j++) {
            const [highId, highPts] = ranked[i]
            const [lowId, lowPts] = ranked[j]
            const diff = highPts - lowPts
            if (diff > 0.01) {
              debts.push({
                from: lowId,
                to: highId,
                amount: Math.round(diff * dollarPerPoint * 100) / 100,
                game: `Wolf R${round.round_number} G${groupNum}`,
                gameType: 'Wolf',
              })
            }
          }
        }
      }
    }

    // Skins (per round, full field)
    for (const round of rounds) {
      const course = courses.find((c) => c.round_number === round.round_number)
      const holes = (course?.holes || []).sort((a, b) => a.hole_number - b.hole_number)
      if (!holes.length) continue

      const roundGroupings = groupings
        .filter((g) => g.round_id === round.id)
        .map((g) => ({ ...g, player: players.find((p) => p.id === g.player_id) }))
      if (!roundGroupings.length) continue

      const roundScores = scores.filter((s) => s.round_id === round.id)
      const skinResults = calcSkins(roundScores, roundGroupings, holes, 1)
      const stotals = skinsTotals(skinResults)
      const numPlayers = roundGroupings.length

      // Each skin winner: everyone else pays equally
      for (const [winnerId, skinCount] of Object.entries(stotals)) {
        const losers = roundGroupings.map((g) => g.player_id).filter((id) => id !== winnerId)
        const perLoser = Math.round((skinCount * dollarPerPoint * numPlayers) / losers.length * 100) / 100
        losers.forEach((lid) => {
          debts.push({ from: lid, to: winnerId, amount: perLoser, game: `Skins R${round.round_number}`, gameType: 'Skins' })
        })
      }
    }

    return debts
  }, [rounds, groupings, scores, wolfHoles, courses, players, payments, dollarPerPoint])

  // Net debts: filter by opted-in games, consolidate same from/to pairs, then subtract paid
  const netDebts = useMemo(() => {
    const pairMap = {}
    for (const d of rawDebts.filter((d) => activeGames.has(d.gameType))) {
      const key = [d.from, d.to].sort().join(':')
      if (!pairMap[key]) pairMap[key] = { ids: [d.from, d.to], net: 0 }
      pairMap[key].net += (d.from === pairMap[key].ids[0] ? 1 : -1) * d.amount
    }

    const result = []
    for (const { ids, net } of Object.values(pairMap)) {
      if (Math.abs(net) < 0.01) continue
      const from = net > 0 ? ids[0] : ids[1]
      const to = net > 0 ? ids[1] : ids[0]
      const amount = Math.abs(net)

      // subtract paid
      const paid = payments
        .filter((p) => p.from_player_id === from && p.to_player_id === to)
        .reduce((s, p) => s + Number(p.amount), 0)
      const remaining = Math.round((amount - paid) * 100) / 100
      result.push({ from, to, total: amount, paid, remaining })
    }
    return result.sort((a, b) => b.remaining - a.remaining)
  }, [rawDebts, payments, activeGames])

  const [paying, setPaying] = useState(null) // { from, to, amount }
  const [payAmount, setPayAmount] = useState('')

  async function handlePay(debt) {
    setPaying({ from: debt.from, to: debt.to, amount: debt.remaining })
    setPayAmount(String(debt.remaining))
  }

  async function confirmPay() {
    if (!paying) return
    try {
      await markPayment({
        tripId,
        fromPlayerId: paying.from,
        toPlayerId: paying.to,
        amount: parseFloat(payAmount),
        note: 'Marked paid',
      })
      await actions.reload()
      setPaying(null)
    } catch (err) {
      alert(err.message)
    }
  }

  const totalOwed = netDebts.reduce((s, d) => s + Math.max(0, d.remaining), 0)

  const inner = (
    <div className={embedded ? '' : 'min-h-screen bg-gray-900 flex flex-col max-w-md mx-auto'}>
      {!embedded && (
        <header className="bg-gray-900 border-b border-gray-800 px-4 py-3 sticky top-0 z-40">
          <h1 className="text-base font-semibold text-white">Pay Up</h1>
          <p className="text-xs text-gray-400">${dollarPerPoint}/pt · Total outstanding: ${totalOwed.toFixed(2)}</p>
        </header>
      )}
      {embedded && (
        <div className="px-4 pt-3 pb-1">
          <p className="text-xs text-gray-500">Total outstanding: <span className="text-white font-semibold">${totalOwed.toFixed(2)}</span></p>
        </div>
      )}

      {/* Game opt-in toggles */}
      <div className="px-4 py-3 bg-gray-900 border-b border-gray-800 flex gap-2">
        {ALL_GAMES.map((game) => {
          const on = activeGames.has(game)
          return (
            <button
              key={game}
              onClick={() => toggleGame(game)}
              className={`flex-1 py-1.5 rounded-lg text-xs font-semibold border-2 transition-colors
                ${on ? 'bg-green-600 border-green-600 text-white' : 'bg-gray-800 border-gray-700 text-gray-500'}`}
            >
              {game}
            </button>
          )
        })}
      </div>

      <div className={`flex-1 p-4 ${embedded ? 'pb-4' : 'pb-28'} space-y-3`}>
        {netDebts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="text-4xl mb-3">🎉</div>
            <p className="font-semibold text-white">All square!</p>
            <p className="text-sm text-gray-500 mt-1">No outstanding debts.</p>
          </div>
        ) : (
          netDebts.map((debt, i) => {
            const fromP = players.find((p) => p.id === debt.from)
            const toP = players.find((p) => p.id === debt.to)
            const settled = debt.remaining <= 0.01

            return (
              <div key={i} className={`bg-gray-800 rounded-xl border overflow-hidden ${settled ? 'border-green-900 opacity-60' : 'border-gray-700'}`}>
                <div className="px-4 py-3 flex items-center gap-3">
                  <div className="flex-1">
                    <div className="text-sm font-semibold text-white">
                      {fromP?.name} → {toP?.name}
                    </div>
                    {debt.paid > 0 && (
                      <div className="text-xs text-gray-400">
                        ${debt.total.toFixed(2)} total · ${debt.paid.toFixed(2)} paid
                      </div>
                    )}
                  </div>
                  <div className="text-right">
                    <div className={`text-lg font-bold ${settled ? 'text-green-400' : 'text-white'}`}>
                      {settled ? '✓' : `$${debt.remaining.toFixed(2)}`}
                    </div>
                  </div>
                </div>
                {!settled && debt.to === playerId && (
                  <div className="px-4 pb-3">
                    <button
                      onClick={() => handlePay(debt)}
                      className="w-full bg-green-600 text-white py-2 rounded-lg text-sm font-semibold"
                    >
                      Mark Paid
                    </button>
                  </div>
                )}
                {!settled && debt.to !== playerId && (
                  <div className="px-4 pb-3">
                    <p className="text-xs text-gray-600 text-center italic">Receiver confirms payment</p>
                  </div>
                )}
              </div>
            )
          })
        )}

        {/* Breakdown */}
        {rawDebts.length > 0 && (
          <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden mt-4">
            <div className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide bg-gray-700">
              Breakdown
            </div>
            <div className="divide-y divide-gray-700">
              {rawDebts.map((d, i) => {
                const fromP = players.find((p) => p.id === d.from)
                const toP = players.find((p) => p.id === d.to)
                return (
                  <div key={i} className="px-4 py-2.5 flex justify-between items-center">
                    <div>
                      <span className="text-sm font-medium text-white">{fromP?.name?.split(' ')[0]} → {toP?.name?.split(' ')[0]}</span>
                      <div className="text-xs text-gray-500">{d.game}</div>
                    </div>
                    <span className="text-sm font-semibold text-gray-300">${d.amount.toFixed(2)}</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* Pay modal */}
      {paying && (
        <div className="fixed inset-0 bg-black/70 flex items-end z-50">
          <div className="bg-gray-800 rounded-t-2xl w-full max-w-md mx-auto p-6 space-y-4">
            <h2 className="text-lg font-bold text-white">Mark Payment</h2>
            <p className="text-sm text-gray-400">
              {players.find((p) => p.id === paying.from)?.name} pays {players.find((p) => p.id === paying.to)?.name}
            </p>
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">Amount ($)</label>
              <input
                type="number"
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                step="0.01"
                className="w-full bg-gray-700 border border-gray-600 text-white rounded-xl px-4 py-3 text-xl font-bold focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
            <div className="flex gap-3">
              <button onClick={() => setPaying(null)} className="flex-1 border border-gray-600 rounded-xl py-3 font-medium text-gray-300">
                Cancel
              </button>
              <button onClick={confirmPay} className="flex-1 bg-green-600 text-white rounded-lg py-3 font-semibold">
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {!embedded && <BottomNav screen="settlement" setScreen={setScreen} />}
    </div>
  )
  return embedded ? inner : inner
}

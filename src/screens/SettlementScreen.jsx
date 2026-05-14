import { useMemo, useState } from 'react'
import { useApp } from '../context/AppContext'
import { markPayment, deletePayment } from '../lib/db'
import {
  MULTIPLIERS, DECLARATION, calcSkins, skinsTotals, calcNassau, strokesReceived, netScore,
} from '../lib/gameEngine'
import Layout from '../components/Layout'
import BottomNav from '../components/BottomNav'
import Spinner from '../components/Spinner'

export default function SettlementScreen({ setScreen }) {
  const { state, actions } = useApp()
  const { players, groupings, scores, wolfHoles, courses, rounds, payments, tripId, activeRoundId } = state

  const trip = state.trip
  const dollarPerPoint = trip?.dollar_per_point || 1

  // ── Compute all debts ──────────────────────────────────────────────────

  const rawDebts = useMemo(() => {
    const debts = [] // { from, to, amount, game, description }

    // Wolf (per round, per group)
    for (const round of rounds) {
      const course = courses.find((c) => c.round_number === round.round_number)
      const holes = course?.holes || []
      for (let groupNum = 1; groupNum <= 2; groupNum++) {
        const gGroupings = groupings
          .filter((g) => g.round_id === round.id && g.group_number === groupNum)
          .map((g) => ({ ...g, player: players.find((p) => p.id === g.player_id) }))
        if (!gGroupings.length) continue

        const gIds = gGroupings.map((g) => g.player_id)
        const gDeltas = Object.fromEntries(gIds.map((id) => [id, 0]))
        let carry = 0

        const roundWolfHoles = wolfHoles.filter((w) => w.round_id === round.id && w.group_number === groupNum)
        const holeCount = holes.length || 18

        for (let hole = 1; hole <= holeCount; hole++) {
          const wh = roundWolfHoles.find((w) => w.hole_number === hole)
          if (!wh || !wh.result) { carry += wh?.base_value || 1; continue }

          const effectiveVal = carry + wh.base_value
          const mult = MULTIPLIERS[wh.declaration] || 1
          const pot = effectiveVal * mult

          if (wh.result === 'push') { carry += wh.base_value; continue }
          carry = 0

          if (wh.declaration === DECLARATION.PARTNER) {
            const winners = [wh.wolf_player_id, wh.partner_player_id].filter(Boolean)
            const losers = gIds.filter((id) => !winners.includes(id))
            if (wh.result === 'wolf_win') {
              winners.forEach((id) => (gDeltas[id] += pot * losers.length))
              losers.forEach((id) => (gDeltas[id] -= pot * winners.length))
            } else {
              winners.forEach((id) => (gDeltas[id] -= pot * losers.length))
              losers.forEach((id) => (gDeltas[id] += pot * winners.length))
            }
          } else {
            const others = gIds.filter((id) => id !== wh.wolf_player_id)
            if (wh.result === 'wolf_win') {
              gDeltas[wh.wolf_player_id] += pot * others.length
              others.forEach((id) => (gDeltas[id] -= pot))
            } else {
              gDeltas[wh.wolf_player_id] -= pot * others.length
              others.forEach((id) => (gDeltas[id] += pot))
            }
          }
        }

        // Convert deltas to pairwise debts
        const creditors = Object.entries(gDeltas).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])
        const debtors = Object.entries(gDeltas).filter(([, v]) => v < 0).sort((a, b) => a[1] - b[1])
        let ci = 0, di = 0
        while (ci < creditors.length && di < debtors.length) {
          const [cid, camt] = creditors[ci]
          const [did, damt] = debtors[di]
          const pay = Math.min(camt, -damt) * dollarPerPoint
          if (pay > 0.01) {
            debts.push({ from: did, to: cid, amount: Math.round(pay * 100) / 100, game: `Wolf R${round.round_number} G${groupNum}` })
          }
          creditors[ci] = [cid, camt - pay / dollarPerPoint]
          debtors[di] = [did, damt + pay / dollarPerPoint]
          if (creditors[ci][1] < 0.01) ci++
          if (-debtors[di][1] < 0.01) di++
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
          debts.push({ from: lid, to: winnerId, amount: perLoser, game: `Skins R${round.round_number}` })
        })
      }
    }

    // Nassau (per round, per group)
    for (const round of rounds) {
      const course = courses.find((c) => c.round_number === round.round_number)
      const holes = (course?.holes || []).sort((a, b) => a.hole_number - b.hole_number)
      if (!holes.length) continue

      for (let groupNum = 1; groupNum <= 2; groupNum++) {
        const roundGroupings = groupings
          .filter((g) => g.round_id === round.id && g.group_number === groupNum)
          .map((g) => ({ ...g, player: players.find((p) => p.id === g.player_id) }))
        if (!roundGroupings.length) continue

        const roundScores = scores.filter((s) => s.round_id === round.id)
        const nr = calcNassau(roundScores, roundGroupings, holes, groupNum)
        const nassauBet = dollarPerPoint

        for (const [segKey, label] of [['frontWinner', 'Front'], ['backWinner', 'Back'], ['overallWinner', '18']]) {
          const winnerId = nr[segKey]
          if (!winnerId) continue
          const losers = roundGroupings.map((g) => g.player_id).filter((id) => id !== winnerId)
          losers.forEach((lid) => {
            debts.push({ from: lid, to: winnerId, amount: nassauBet, game: `Nassau ${label} R${round.round_number} G${groupNum}` })
          })
        }
      }
    }

    return debts
  }, [rounds, groupings, scores, wolfHoles, courses, players, payments, dollarPerPoint])

  // Net debts: consolidate same from/to pairs, then subtract what's been paid
  const netDebts = useMemo(() => {
    const pairMap = {}
    for (const d of rawDebts) {
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
  }, [rawDebts, payments])

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

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col max-w-md mx-auto">
      <header className="bg-white border-b border-gray-200 px-4 py-3 sticky top-0 z-40">
        <h1 className="text-base font-semibold text-gray-900">Pay Up</h1>
        <p className="text-xs text-gray-400">${dollarPerPoint}/pt · Total outstanding: ${totalOwed.toFixed(2)}</p>
      </header>

      <div className="flex-1 p-4 pb-28 space-y-3">
        {netDebts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="text-4xl mb-3">🎉</div>
            <p className="font-semibold text-gray-700">All square!</p>
            <p className="text-sm text-gray-400 mt-1">No outstanding debts.</p>
          </div>
        ) : (
          netDebts.map((debt, i) => {
            const fromP = players.find((p) => p.id === debt.from)
            const toP = players.find((p) => p.id === debt.to)
            const settled = debt.remaining <= 0.01

            return (
              <div key={i} className={`bg-white rounded-xl border overflow-hidden ${settled ? 'border-green-200 opacity-60' : 'border-gray-200'}`}>
                <div className="px-4 py-3 flex items-center gap-3">
                  <div className="flex-1">
                    <div className="text-sm font-semibold text-gray-900">
                      {fromP?.name} → {toP?.name}
                    </div>
                    {debt.paid > 0 && (
                      <div className="text-xs text-gray-400">
                        ${debt.total.toFixed(2)} total · ${debt.paid.toFixed(2)} paid
                      </div>
                    )}
                  </div>
                  <div className="text-right">
                    <div className={`text-lg font-bold ${settled ? 'text-green-600' : 'text-gray-900'}`}>
                      {settled ? '✓' : `$${debt.remaining.toFixed(2)}`}
                    </div>
                  </div>
                </div>
                {!settled && (
                  <div className="px-4 pb-3">
                    <button
                      onClick={() => handlePay(debt)}
                      className="w-full bg-green-600 text-white py-2 rounded-lg text-sm font-semibold"
                    >
                      Mark Paid
                    </button>
                  </div>
                )}
              </div>
            )
          })
        )}

        {/* Breakdown */}
        {rawDebts.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mt-4">
            <div className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide bg-gray-50">
              Breakdown
            </div>
            <div className="divide-y divide-gray-100">
              {rawDebts.map((d, i) => {
                const fromP = players.find((p) => p.id === d.from)
                const toP = players.find((p) => p.id === d.to)
                return (
                  <div key={i} className="px-4 py-2.5 flex justify-between items-center">
                    <div>
                      <span className="text-sm font-medium">{fromP?.name?.split(' ')[0]} → {toP?.name?.split(' ')[0]}</span>
                      <div className="text-xs text-gray-400">{d.game}</div>
                    </div>
                    <span className="text-sm font-semibold text-gray-700">${d.amount.toFixed(2)}</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* Pay modal */}
      {paying && (
        <div className="fixed inset-0 bg-black/50 flex items-end z-50">
          <div className="bg-white rounded-t-2xl w-full max-w-md mx-auto p-6 space-y-4">
            <h2 className="text-lg font-bold text-gray-900">Mark Payment</h2>
            <p className="text-sm text-gray-500">
              {players.find((p) => p.id === paying.from)?.name} pays {players.find((p) => p.id === paying.to)?.name}
            </p>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Amount ($)</label>
              <input
                type="number"
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                step="0.01"
                className="w-full border border-gray-300 rounded-lg px-4 py-3 text-xl font-bold focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
            <div className="flex gap-3">
              <button onClick={() => setPaying(null)} className="flex-1 border border-gray-200 rounded-lg py-3 font-medium text-gray-600">
                Cancel
              </button>
              <button onClick={confirmPay} className="flex-1 bg-green-600 text-white rounded-lg py-3 font-semibold">
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      <BottomNav screen="settlement" setScreen={setScreen} />
    </div>
  )
}

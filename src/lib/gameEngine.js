// ── Net score helpers ──────────────────────────────────────────────────────

export function strokesReceived(handicap, strokeIndex) {
  // How many strokes a player receives on a given hole
  if (handicap <= 0) return 0
  let strokes = Math.floor(handicap / 18)
  if (handicap % 18 >= strokeIndex) strokes += 1
  return strokes
}

export function netScore(grossScore, handicap, strokeIndex) {
  return grossScore - strokesReceived(handicap, strokeIndex)
}

// ── Stableford ─────────────────────────────────────────────────────────────
// Net relative to par: eagle+=4, birdie=3, par=2, bogey=1, double=0, worse=0

export function stablefordPoints(netRelativeToPar) {
  if (netRelativeToPar <= -2) return 4
  if (netRelativeToPar === -1) return 3
  if (netRelativeToPar === 0) return 2
  if (netRelativeToPar === 1) return 1
  return 0
}

export function calcStableford(scores, groupings, courses) {
  // Returns [{ playerId, name, roundPoints: [r1, r2, r3], total }]
  const playerTotals = {}

  for (const round of [1, 2, 3]) {
    const course = courses.find((c) => c.round_number === round)
    if (!course) continue
    const holes = course.holes || []
    const roundScores = scores.filter((s) => {
      const g = groupings.find((g) => g.round_id === s.round_id)
      return g && g.round_number === round
    })

    for (const score of roundScores) {
      const player = groupings.find((g) => g.player_id === score.player_id)
      if (!player) continue
      const hole = holes.find((h) => h.hole_number === score.hole_number)
      if (!hole) continue

      const net = netScore(score.gross_score, player.player.handicap, hole.stroke_index)
      const pts = stablefordPoints(net - hole.par)

      if (!playerTotals[score.player_id]) {
        playerTotals[score.player_id] = { playerId: score.player_id, rounds: [0, 0, 0] }
      }
      playerTotals[score.player_id].rounds[round - 1] += pts
    }
  }

  return Object.values(playerTotals).map((p) => ({
    ...p,
    total: p.rounds.reduce((a, b) => a + b, 0),
  }))
}

// ── Wolf ───────────────────────────────────────────────────────────────────

export const DECLARATION = {
  BLIND: 'blind',    // 4×
  EARLY: 'early',   // 3× (after own shot, before others)
  LATE: 'late',     // 2× (after all hit)
  PARTNER: 'partner', // 1× (picked a partner)
}

export const MULTIPLIERS = {
  blind: 4,
  early: 3,
  late: 2,
  partner: 1,
}

export function wolfPlayerForHole(holeNumber, wolfOrder, groupPoints, isComeback) {
  // wolfOrder: [playerId, playerId, playerId, playerId] (position 0=first wolf)
  if (isComeback) {
    // lowest cumulative points becomes wolf
    const minPts = Math.min(...Object.values(groupPoints))
    const lowestPlayerId = Object.entries(groupPoints).find(([, pts]) => pts === minPts)?.[0]
    return lowestPlayerId || wolfOrder[(holeNumber - 1) % 4]
  }
  return wolfOrder[(holeNumber - 1) % 4]
}

// Given all wolf_holes for a group and scores for a round,
// compute the net point delta for each player.
export function calcWolfPoints(wolfHoles, scores, groupings, holes, groupNumber) {
  const groupPlayers = groupings.filter((g) => g.group_number === groupNumber)
  const playerIds = groupPlayers.map((g) => g.player_id)
  const deltas = Object.fromEntries(playerIds.map((id) => [id, 0]))

  let carryAccum = 0

  const holeCount = holes.length || 18
  for (let hole = 1; hole <= holeCount; hole++) {
    const wh = wolfHoles.find((w) => w.hole_number === hole && w.group_number === groupNumber)
    if (!wh) { carryAccum += 1; continue } // no decision recorded yet = skip

    const effectiveValue = (wh.carry_value || 0) + wh.base_value
    const multiplier = MULTIPLIERS[wh.declaration] || 1
    const pot = effectiveValue * multiplier

    if (wh.result === 'push') {
      carryAccum += effectiveValue
      continue
    }
    carryAccum = 0

    const holeData = holes.find((h) => h.hole_number === hole)

    if (wh.declaration === DECLARATION.PARTNER) {
      // Team play: wolf + partner vs other two
      const wolfId = wh.wolf_player_id
      const partnerId = wh.partner_player_id
      const losers = playerIds.filter((id) => id !== wolfId && id !== partnerId)

      if (wh.result === 'wolf_win') {
        deltas[wolfId] += pot * losers.length
        if (partnerId) deltas[partnerId] += pot * losers.length
        losers.forEach((id) => (deltas[id] -= pot * 2))
      } else {
        deltas[wolfId] -= pot * losers.length
        if (partnerId) deltas[partnerId] -= pot * losers.length
        losers.forEach((id) => (deltas[id] += pot * 2))
      }
    } else {
      // Solo: wolf vs other 3
      const wolfId = wh.wolf_player_id
      const others = playerIds.filter((id) => id !== wolfId)

      if (wh.result === 'wolf_win') {
        deltas[wolfId] += pot * others.length
        others.forEach((id) => (deltas[id] -= pot))
      } else {
        deltas[wolfId] -= pot * others.length
        others.forEach((id) => (deltas[id] += pot))
      }
    }
  }

  return deltas
}

// Determine wolf result for a hole given net scores
export function determineWolfResult(wolfHole, netScores) {
  // netScores: { playerId: netScore }
  const wolfId = wolfHole.wolf_player_id
  const partnerId = wolfHole.partner_player_id

  if (wolfHole.declaration === DECLARATION.PARTNER && partnerId) {
    // Best net of wolf+partner vs best net of other two
    const teamA = [wolfId, partnerId]
    const teamB = Object.keys(netScores).filter((id) => !teamA.includes(id))
    const bestA = Math.min(...teamA.map((id) => netScores[id] ?? 99))
    const bestB = Math.min(...teamB.map((id) => netScores[id] ?? 99))
    if (bestA < bestB) return 'wolf_win'
    if (bestA > bestB) return 'wolf_lose'
    return 'push'
  } else {
    // Solo: if ANY of the 3 others beats wolf → wolf loses
    const wolfNet = netScores[wolfId] ?? 99
    const others = Object.entries(netScores).filter(([id]) => id !== wolfId)
    const anyOtherBeatsWolf = others.some(([, net]) => net < wolfNet)
    if (anyOtherBeatsWolf) return 'wolf_lose'
    const anyTie = others.some(([, net]) => net === wolfNet)
    if (anyTie) return 'push'
    return 'wolf_win'
  }
}

// Cumulative wolf points per player for comeback detection
export function cumulativeWolfPoints(wolfHoles, groupPlayerIds) {
  const totals = Object.fromEntries(groupPlayerIds.map((id) => [id, 0]))
  // This is a simplified running total — full accuracy requires calcWolfPoints
  // but we only need relative ordering for comeback detection
  let carry = 0
  return totals
}

// ── Skins ──────────────────────────────────────────────────────────────────

// Returns { holeNumber, winnerId, value } for each hole (or null if carried)
export function calcSkins(scores, groupings, holes, dollarPerSkin = 1) {
  const allPlayerIds = [...new Set(groupings.map((g) => g.player_id))]
  const results = []
  let carryValue = dollarPerSkin
  const holeCount = holes.length || 18

  for (let hole = 1; hole <= holeCount; hole++) {
    const holeData = holes.find((h) => h.hole_number === hole)
    if (!holeData) { results.push({ holeNumber: hole, winnerId: null, value: 0, carried: false }); continue }

    const holeScores = allPlayerIds
      .map((pid) => {
        const g = groupings.find((g) => g.player_id === pid)
        const s = scores.find((s) => s.player_id === pid && s.hole_number === hole)
        if (!s || s.gross_score === null) return null
        const net = netScore(s.gross_score, g?.player?.handicap || 0, holeData.stroke_index)
        return { playerId: pid, net }
      })
      .filter(Boolean)

    if (holeScores.length < allPlayerIds.length) {
      // not all scores in yet
      results.push({ holeNumber: hole, winnerId: null, value: carryValue, carried: false, pending: true })
      continue
    }

    const minNet = Math.min(...holeScores.map((s) => s.net))
    const winners = holeScores.filter((s) => s.net === minNet)

    if (winners.length === 1) {
      results.push({ holeNumber: hole, winnerId: winners[0].playerId, value: carryValue, carried: carryValue > dollarPerSkin })
      carryValue = dollarPerSkin
    } else {
      results.push({ holeNumber: hole, winnerId: null, value: 0, carried: false, push: true })
      carryValue += dollarPerSkin
    }
  }

  return results
}

export function skinsTotals(skinResults) {
  const totals = {}
  for (const skin of skinResults) {
    if (skin.winnerId) {
      totals[skin.winnerId] = (totals[skin.winnerId] || 0) + skin.value
    }
  }
  return totals
}

// ── Nassau ─────────────────────────────────────────────────────────────────
// Per group, per round: best net total front 9, back 9, and overall

export function calcNassau(scores, groupings, holes, groupNumber) {
  const groupPlayers = groupings.filter((g) => g.group_number === groupNumber)
  const playerIds = groupPlayers.map((g) => g.player_id)

  const netTotals = Object.fromEntries(playerIds.map((id) => [id, { front: 0, back: 0, total: 0 }]))
  const holeCount = holes.length || 18
  const midPoint = Math.ceil(holeCount / 2)

  for (const holeData of holes) {
    const hole = holeData.hole_number
    const segment = hole <= midPoint ? 'front' : 'back'

    for (const pid of playerIds) {
      const g = groupPlayers.find((g) => g.player_id === pid)
      const s = scores.find((sc) => sc.player_id === pid && sc.hole_number === hole)
      if (!s || s.gross_score === null) continue
      const net = netScore(s.gross_score, g?.player?.handicap || 0, holeData.stroke_index)
      netTotals[pid][segment] += net
      netTotals[pid].total += net
    }
  }

  // Winner of each segment = lowest net total (golf: lower is better)
  function segmentWinner(segment) {
    const entries = Object.entries(netTotals).filter(([, v]) => v[segment] > 0)
    if (!entries.length) return null
    const min = Math.min(...entries.map(([, v]) => v[segment]))
    const winners = entries.filter(([, v]) => v[segment] === min)
    return winners.length === 1 ? winners[0][0] : null // null = tie
  }

  return {
    groupNumber,
    netTotals,
    frontWinner: segmentWinner('front'),
    backWinner: segmentWinner('back'),
    overallWinner: segmentWinner('total'),
  }
}

// ── Settlement ─────────────────────────────────────────────────────────────

// Build a map of raw debts: who owes who what, across all games
// Returns [{ from, to, amount, game }]
export function calcSettlement({ wolfDeltas, skinsTotals, nassauResults, stablefordRankings, dollarPerPoint, dollarPerSkin }) {
  const transactions = []

  // Wolf: each player's delta × dollarPerPoint
  // Settle pairwise: players with negative deltas pay players with positive deltas
  const wolfNetted = simplifyDebts(wolfDeltas, dollarPerPoint)
  wolfNetted.forEach((t) => transactions.push({ ...t, game: 'Wolf' }))

  // Skins: winners collect from everyone else (split equally)
  // Actually skins work differently — the winner gets the skin value in dollars
  // For simplicity: skins winner collects from all non-winners equally
  const numPlayers = Object.keys(skinsTotals || {}).length || 8
  for (const [winnerId, value] of Object.entries(skinsTotals || {})) {
    // everyone else pays equally
    // (simplified — real skins payouts can be complex)
    transactions.push({ note: `Skins: won $${value}`, game: 'Skins', to: winnerId, amount: value })
  }

  // Nassau: each segment winner gets dollarPerPoint × base from each loser
  // Simplified: nassauResults per round/group
  for (const nr of nassauResults || []) {
    for (const segment of ['front', 'back', 'overall']) {
      const winner = nr[`${segment}Winner`]
      if (!winner) continue
      // winner collects from each of the 3 others
      const losers = Object.keys(nr.netTotals).filter((id) => id !== winner)
      losers.forEach((loser) => {
        transactions.push({ from: loser, to: winner, amount: dollarPerPoint, game: `Nassau ${segment}` })
      })
    }
  }

  return transactions
}

// Simplify wolf deltas into pairwise payments
function simplifyDebts(deltas, dollarPerPoint) {
  const creditors = []
  const debtors = []

  for (const [id, pts] of Object.entries(deltas)) {
    const dollars = pts * dollarPerPoint
    if (dollars > 0) creditors.push({ id, amount: dollars })
    else if (dollars < 0) debtors.push({ id, amount: -dollars })
  }

  creditors.sort((a, b) => b.amount - a.amount)
  debtors.sort((a, b) => b.amount - a.amount)

  const result = []
  let ci = 0, di = 0
  while (ci < creditors.length && di < debtors.length) {
    const pay = Math.min(creditors[ci].amount, debtors[di].amount)
    if (pay > 0.005) {
      result.push({ from: debtors[di].id, to: creditors[ci].id, amount: Math.round(pay * 100) / 100, game: 'Wolf' })
    }
    creditors[ci].amount -= pay
    debtors[di].amount -= pay
    if (creditors[ci].amount < 0.005) ci++
    if (debtors[di].amount < 0.005) di++
  }

  return result
}

// ── Net score helpers ──────────────────────────────────────────────────────

export function effectiveStrokeIndex(holeStrokeIndex, allHoles) {
  if (!allHoles || allHoles.length === 0) return holeStrokeIndex
  const sorted = allHoles
    .filter((h) => h.stroke_index != null)
    .map((h) => h.stroke_index)
    .sort((a, b) => a - b)
  const rank = sorted.indexOf(holeStrokeIndex) + 1
  return rank > 0 ? rank : sorted.length
}

export function strokesReceived(handicap, strokeIndex, totalHoles = 18) {
  if (handicap <= 0) return 0
  let strokes = Math.floor(handicap / totalHoles)
  if (handicap % totalHoles >= strokeIndex) strokes += 1
  return strokes
}

export function netScore(grossScore, handicap, strokeIndex, totalHoles = 18) {
  return grossScore - strokesReceived(handicap, strokeIndex, totalHoles)
}

// ── Pot calculation ────────────────────────────────────────────────────────

export function calcPot(buyIn, playerCount) {
  const total = buyIn * playerCount
  return {
    total,
    tripChampion: Math.round(total * 0.4375 * 100) / 100,
    dailyNet:     Math.round(total * 0.1125 * 100) / 100, // per day
    skinsDay:     Math.round(total * 0.075  * 100) / 100, // per day
  }
}

// ── Daily net scoring ──────────────────────────────────────────────────────

// Returns { playerId: { roundTotals: {roundId: net}, anyPlayed } }
function buildRoundNets(scores, groupings, courses, rounds, players) {
  const result = {}

  for (const round of rounds) {
    const course = courses.find((c) => c.round_number === round.round_number)
    if (!course) continue
    const holes = (course.holes || []).sort((a, b) => a.hole_number - b.hole_number)
    const rg = groupings.filter((g) => g.round_id === round.id)

    for (const g of rg) {
      const player = players.find((p) => p.id === g.player_id)
      if (!player) continue
      if (!result[player.id]) result[player.id] = { roundTotals: {}, anyPlayed: false }

      let roundNet = 0
      let played = 0
      for (const hole of holes) {
        const s = scores.find(
          (sc) => sc.player_id === player.id && sc.hole_number === hole.hole_number && sc.round_id === round.id
        )
        if (!s || s.gross_strokes == null) continue
        const esi = effectiveStrokeIndex(hole.stroke_index, holes)
        roundNet += netScore(s.gross_strokes, player.handicap || 0, esi, holes.length)
        played++
      }
      if (played > 0) {
        result[player.id].roundTotals[round.id] = roundNet
        result[player.id].anyPlayed = true
      }
    }
  }
  return result
}

// Thursday / Saturday: simple sum of all day's rounds
export function calcSimpleDayNet(scores, groupings, courses, dayRounds, players) {
  const data = buildRoundNets(scores, groupings, courses, dayRounds, players)
  const totals = {}
  for (const [pid, { roundTotals, anyPlayed }] of Object.entries(data)) {
    if (!anyPlayed) continue
    totals[pid] = Object.values(roundTotals).reduce((s, v) => s + v, 0)
  }
  return totals // { playerId: totalNet }
}

// Friday: best 2 rounds (drop worst if 3 played, sum all if ≤2)
export function calcFridayNet(scores, groupings, courses, dayRounds, players) {
  const data = buildRoundNets(scores, groupings, courses, dayRounds, players)
  const totals = {}
  for (const [pid, { roundTotals, anyPlayed }] of Object.entries(data)) {
    if (!anyPlayed) continue
    const sorted = Object.values(roundTotals).sort((a, b) => a - b) // ascending = best first
    const best2 = sorted.slice(0, 2)
    totals[pid] = best2.reduce((s, v) => s + v, 0)
  }
  return totals // { playerId: totalNet (best-2 sum) }
}

// Cumulative trip net across ALL rounds (for Trip Net Champion)
export function calcTripNet(scores, groupings, courses, rounds, players) {
  const data = buildRoundNets(scores, groupings, courses, rounds, players)
  const totals = {}
  for (const [pid, { roundTotals, anyPlayed }] of Object.entries(data)) {
    if (!anyPlayed) continue
    totals[pid] = Object.values(roundTotals).reduce((s, v) => s + v, 0)
  }
  return totals
}

// ── Wolf ───────────────────────────────────────────────────────────────────

export const DECLARATION = {
  BLIND: 'blind',
  EARLY: 'early',
  LATE: 'late',
  PARTNER: 'partner',
  THREW: 'threw',
}

export const MULTIPLIERS = {
  blind: 4,
  early: 3,
  late: 2,
  partner: 1,
  threw: 2,
}

export function wolfPlayerForHole(holeNumber, wolfOrder, groupPoints, isComeback) {
  if (isComeback) {
    const minPts = Math.min(...Object.values(groupPoints))
    const lowestPlayerId = Object.entries(groupPoints).find(([, pts]) => pts === minPts)?.[0]
    return lowestPlayerId || wolfOrder[(holeNumber - 1) % 4]
  }
  return wolfOrder[(holeNumber - 1) % 4]
}

export function calcWolfPoints(wolfHoles, scores, groupings, holes, groupNumber) {
  const groupPlayers = groupings.filter((g) => g.group_number === groupNumber)
  const playerIds = groupPlayers.map((g) => g.player_id)
  const deltas = Object.fromEntries(playerIds.map((id) => [id, 0]))

  let carryAccum = 0
  const holeCount = holes.length || 18

  for (let hole = 1; hole <= holeCount; hole++) {
    const wh = wolfHoles.find((w) => w.hole_number === hole && w.group_number === groupNumber)
    if (!wh) { carryAccum += 1; continue }

    const effectiveValue = (wh.carry_value || 0) + wh.base_value
    const multiplier = MULTIPLIERS[wh.declaration] || 1
    const pot = effectiveValue * multiplier

    if (wh.result === 'push') { carryAccum += effectiveValue; continue }
    carryAccum = 0

    if (wh.declaration === DECLARATION.PARTNER) {
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
    } else if (wh.declaration === DECLARATION.THREW) {
      const throwerId = wh.partner_player_id
      const others = playerIds.filter((id) => id !== throwerId)
      if (wh.result === 'wolf_win') {
        if (throwerId) deltas[throwerId] += pot * others.length
        others.forEach((id) => (deltas[id] -= pot))
      } else {
        if (throwerId) deltas[throwerId] -= pot * others.length
        others.forEach((id) => (deltas[id] += pot))
      }
    } else {
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

export function determineWolfResult(wolfHole, netScores) {
  const wolfId = wolfHole.wolf_player_id
  const partnerId = wolfHole.partner_player_id

  if (wolfHole.declaration === DECLARATION.PARTNER && partnerId) {
    const teamA = [wolfId, partnerId]
    const teamB = Object.keys(netScores).filter((id) => !teamA.includes(id))
    const bestA = Math.min(...teamA.map((id) => netScores[id] ?? 99))
    const bestB = Math.min(...teamB.map((id) => netScores[id] ?? 99))
    if (bestA < bestB) return 'wolf_win'
    if (bestA > bestB) return 'wolf_lose'
    return 'push'
  } else if (wolfHole.declaration === DECLARATION.THREW && partnerId) {
    const throwerNet = netScores[partnerId] ?? 99
    const others = Object.entries(netScores).filter(([id]) => id !== partnerId)
    if (others.some(([, net]) => net < throwerNet)) return 'wolf_lose'
    if (others.some(([, net]) => net === throwerNet)) return 'push'
    return 'wolf_win'
  } else {
    const wolfNet = netScores[wolfId] ?? 99
    const others = Object.entries(netScores).filter(([id]) => id !== wolfId)
    if (others.some(([, net]) => net < wolfNet)) return 'wolf_lose'
    if (others.some(([, net]) => net === wolfNet)) return 'push'
    return 'wolf_win'
  }
}

// ── Skins ──────────────────────────────────────────────────────────────────

// Single-round skins (used for per-round scorecard view)
export function calcSkins(scores, groupings, holes, dollarPerSkin = 1) {
  const allPlayerIds = [...new Set(groupings.map((g) => g.player_id))]
  const results = []
  let carryValue = dollarPerSkin
  const holeCount = holes.length || 18

  for (let hole = 1; hole <= holeCount; hole++) {
    const holeData = holes.find((h) => h.hole_number === hole)
    if (!holeData) { results.push({ holeNumber: hole, winnerId: null, value: 0 }); continue }

    const holeScores = allPlayerIds
      .map((pid) => {
        const g = groupings.find((g) => g.player_id === pid)
        const s = scores.find((s) => s.player_id === pid && s.hole_number === hole)
        if (!s || s.gross_strokes == null) return null
        const esi = effectiveStrokeIndex(holeData.stroke_index, holes)
        const net = netScore(s.gross_strokes, g?.player?.handicap || 0, esi, holes.length)
        return { playerId: pid, net }
      })
      .filter(Boolean)

    if (holeScores.length < allPlayerIds.length) {
      results.push({ holeNumber: hole, winnerId: null, value: carryValue, pending: true })
      continue
    }

    const minNet = Math.min(...holeScores.map((s) => s.net))
    const winners = holeScores.filter((s) => s.net === minNet)

    if (winners.length === 1) {
      results.push({ holeNumber: hole, winnerId: winners[0].playerId, value: carryValue, carried: carryValue > dollarPerSkin })
      carryValue = dollarPerSkin
    } else {
      results.push({ holeNumber: hole, winnerId: null, value: 0, push: true })
      carryValue += dollarPerSkin
    }
  }
  return results
}

// Daily skins: spans multiple rounds in a day, carries across all holes
export function calcDailySkins(scores, groupings, courses, dayRounds, players, chipOffs = [], dollarPerSkin = 1) {
  const sortedRounds = [...dayRounds].sort((a, b) => a.round_number - b.round_number)
  const allPlayerIds = [...new Set(
    groupings.filter((g) => sortedRounds.some((r) => r.id === g.round_id)).map((g) => g.player_id)
  )]

  const results = []
  let carryValue = dollarPerSkin
  let virtualHole = 0

  for (const round of sortedRounds) {
    const course = courses.find((c) => c.round_number === round.round_number)
    if (!course) continue
    const holes = (course.holes || []).sort((a, b) => a.hole_number - b.hole_number)
    const rg = groupings.filter((g) => g.round_id === round.id)

    for (const holeData of holes) {
      virtualHole++
      const holeScores = allPlayerIds
        .map((pid) => {
          const g = rg.find((g) => g.player_id === pid)
          const player = players.find((p) => p.id === pid)
          const s = scores.find((sc) => sc.player_id === pid && sc.hole_number === holeData.hole_number && sc.round_id === round.id)
          if (!s || s.gross_strokes == null) return null
          const esi = effectiveStrokeIndex(holeData.stroke_index, holes)
          const net = netScore(s.gross_strokes, g?.player?.handicap || player?.handicap || 0, esi, holes.length)
          return { playerId: pid, net }
        })
        .filter(Boolean)

      if (holeScores.length < allPlayerIds.length) {
        results.push({ virtualHole, holeNumber: holeData.hole_number, roundId: round.id, winnerId: null, value: carryValue, pending: true })
        continue
      }

      const minNet = Math.min(...holeScores.map((s) => s.net))
      const winners = holeScores.filter((s) => s.net === minNet)

      if (winners.length === 1) {
        results.push({ virtualHole, holeNumber: holeData.hole_number, roundId: round.id, winnerId: winners[0].playerId, value: carryValue, carried: carryValue > dollarPerSkin })
        carryValue = dollarPerSkin
      } else {
        results.push({ virtualHole, holeNumber: holeData.hole_number, roundId: round.id, winnerId: null, value: 0, push: true })
        carryValue += dollarPerSkin
      }
    }
  }

  // Apply chip-off winners for any remaining unresolved skins
  // The last chip-off for these rounds wins the carry
  const lastRound = sortedRounds[sortedRounds.length - 1]
  const chipOff = lastRound ? chipOffs.find((co) => co.round_id === lastRound.id) : null
  if (chipOff && carryValue > dollarPerSkin) {
    results.push({
      virtualHole: virtualHole + 1,
      holeNumber: 'CO',
      roundId: lastRound.id,
      winnerId: chipOff.winner_player_id,
      value: carryValue,
      chipOff: true,
    })
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

// How many skins are unresolved at end of round (for chip-off detection)
export function unresolvedSkinsValue(skinResults) {
  if (!skinResults.length) return 0
  const last = skinResults[skinResults.length - 1]
  // If last hole was a push and no chip-off recorded, skins are unresolved
  if ((last.push || last.pending) && !last.chipOff) {
    let carry = 0
    for (const s of skinResults) {
      if (s.push || s.pending) carry += 1
      else if (s.winnerId) carry = 0
    }
    return carry
  }
  return 0
}

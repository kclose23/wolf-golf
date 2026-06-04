import { supabase } from './supabase'

// Colors auto-assigned to players in order
const PLAYER_COLORS = ['#16a34a','#2563eb','#dc2626','#d97706','#7c3aed','#db2777','#0891b2','#65a30d']

// ── Trips ──────────────────────────────────────────────────────────────────

export async function getTrip(tripId) {
  const { data, error } = await supabase
    .from('trips')
    .select('*')
    .eq('id', tripId)
    .single()
  if (error) throw error
  return data
}

export async function completeTrip(tripId) {
  const { error } = await supabase
    .from('trips')
    .update({ status: 'complete' })
    .eq('id', tripId)
  if (error) throw error
}

export async function getTripByCode(joinCode) {
  const { data, error } = await supabase
    .from('trips')
    .select('*')
    .eq('join_code', joinCode.toUpperCase())
    .single()
  if (error && error.code !== 'PGRST116') throw error
  return data
}

export async function createTrip({ name, joinCode, dollarPerPoint = 1, buyIn = 0 }) {
  const { data, error } = await supabase
    .from('trips')
    .insert({ name, join_code: joinCode.toUpperCase(), dollar_per_point: dollarPerPoint, buy_in: buyIn })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateTripDollarPerPoint(tripId, dollarPerPoint) {
  const { error } = await supabase
    .from('trips')
    .update({ dollar_per_point: dollarPerPoint })
    .eq('id', tripId)
  if (error) throw error
}

// ── Players ────────────────────────────────────────────────────────────────

export async function getPlayers(tripId) {
  const { data, error } = await supabase
    .from('players')
    .select('*')
    .eq('trip_id', tripId)
    .order('name')
  if (error) throw error
  return data
}

export async function createPlayer({ tripId, name, handicap = 0, colorHex, userId, isAdmin = false }) {
  const color = colorHex || PLAYER_COLORS[Math.floor(Math.random() * PLAYER_COLORS.length)]
  const row = { trip_id: tripId, name, handicap, color_hex: color, is_admin: isAdmin }
  if (userId) row.user_id = userId
  const { data, error } = await supabase
    .from('players')
    .insert(row)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updatePlayerUserId(playerId, userId) {
  const { error } = await supabase
    .from('players')
    .update({ user_id: userId })
    .eq('id', playerId)
  if (error) throw error
}

export async function updatePlayerHandicap(playerId, handicap) {
  const { error } = await supabase
    .from('players')
    .update({ handicap })
    .eq('id', playerId)
  if (error) throw error
}

// ── Courses & Holes ────────────────────────────────────────────────────────

export async function getCourses(tripId) {
  const { data, error } = await supabase
    .from('courses')
    .select('*, holes(*)')
    .eq('trip_id', tripId)
    .order('round_number')
  if (error) throw error
  return data
}

export async function saveCourse({ tripId, name, roundNumber, holes }) {
  const { data: course, error: cErr } = await supabase
    .from('courses')
    .upsert(
      { trip_id: tripId, name, round_number: roundNumber },
      { onConflict: 'trip_id,round_number' }
    )
    .select()
    .single()
  if (cErr) throw cErr

  await supabase.from('holes').delete().eq('course_id', course.id)

  const holeRows = holes.map((h) => ({
    course_id: course.id,
    hole_number: h.holeNumber,
    par: h.par,
    stroke_index: h.strokeIndex,
    yards: h.yards || null,
  }))
  const { error: hErr } = await supabase.from('holes').insert(holeRows)
  if (hErr) throw hErr

  return course
}

// ── Rounds ─────────────────────────────────────────────────────────────────

export async function getRounds(tripId) {
  const { data, error } = await supabase
    .from('rounds')
    .select('*')
    .eq('trip_id', tripId)
    .order('round_number')
  if (error) throw error
  return data
}

export async function createOrUpdateRound({ tripId, roundNumber, courseId, date, status = 'active', dayLabel = null }) {
  const { data, error } = await supabase
    .from('rounds')
    .upsert(
      { trip_id: tripId, round_number: roundNumber, course_id: courseId || null, date: date || null, status, day_label: dayLabel },
      { onConflict: 'trip_id,round_number' }
    )
    .select()
    .single()
  if (error) throw error
  return data
}

export async function setRoundStatus(roundId, status) {
  const { error } = await supabase.from('rounds').update({ status }).eq('id', roundId)
  if (error) throw error
}

export async function deleteTrip(tripId) {
  // Fetch IDs needed for child-table deletes
  const [{ data: rounds }, { data: courses }] = await Promise.all([
    supabase.from('rounds').select('id').eq('trip_id', tripId),
    supabase.from('courses').select('id').eq('trip_id', tripId),
  ])
  const roundIds = rounds?.map((r) => r.id) || []
  const courseIds = courses?.map((c) => c.id) || []

  if (roundIds.length > 0) {
    await Promise.all([
      supabase.from('wolf_holes').delete().in('round_id', roundIds),
      supabase.from('scores').delete().in('round_id', roundIds),
      supabase.from('groupings').delete().in('round_id', roundIds),
    ])
  }
  if (courseIds.length > 0) {
    await supabase.from('holes').delete().in('course_id', courseIds)
  }
  await Promise.all([
    supabase.from('rounds').delete().eq('trip_id', tripId),
    supabase.from('courses').delete().eq('trip_id', tripId),
    supabase.from('payments').delete().eq('trip_id', tripId),
    supabase.from('players').delete().eq('trip_id', tripId),
  ])
  const { error } = await supabase.from('trips').delete().eq('id', tripId)
  if (error) throw error
}

export async function deleteRound(roundId) {
  // Delete dependents first (no cascade assumed)
  await Promise.all([
    supabase.from('wolf_holes').delete().eq('round_id', roundId),
    supabase.from('scores').delete().eq('round_id', roundId),
    supabase.from('groupings').delete().eq('round_id', roundId),
  ])
  const { error } = await supabase.from('rounds').delete().eq('id', roundId)
  if (error) throw error
}

// ── Groupings ──────────────────────────────────────────────────────────────
// One row per player per round: which group + wolf order (1–4)

export async function getGroupings(roundId) {
  const { data, error } = await supabase
    .from('groupings')
    .select('*, player:players(*)')
    .eq('round_id', roundId)
    .order('group_number')
    .order('wolf_order')
  if (error) throw error
  return data
}

export async function saveGroupings(roundId, groupingsArray) {
  // groupingsArray: [{ playerId, groupNumber, wolfOrder }]
  await supabase.from('groupings').delete().eq('round_id', roundId)
  if (!groupingsArray.length) return

  const rows = groupingsArray.map((g) => ({
    round_id: roundId,
    player_id: g.playerId,
    group_number: g.groupNumber,
    wolf_order: g.wolfOrder,
  }))
  const { error } = await supabase.from('groupings').insert(rows)
  if (error) throw error
}

// ── Scores ─────────────────────────────────────────────────────────────────
// DB column: gross_strokes (not gross_score)

export async function getScores(roundId) {
  const { data, error } = await supabase
    .from('scores')
    .select('*')
    .eq('round_id', roundId)
    .order('hole_number')
  if (error) throw error
  return data
}

export async function upsertScore({ roundId, playerId, holeNumber, grossScore }) {
  const { error } = await supabase
    .from('scores')
    .upsert(
      { round_id: roundId, player_id: playerId, hole_number: holeNumber, gross_strokes: grossScore },
      { onConflict: 'round_id,player_id,hole_number' }
    )
  if (error) throw error
}

export async function upsertScores(scores) {
  if (!scores.length) return
  // scores array uses gross_strokes column
  const rows = scores.map((s) => ({
    round_id: s.round_id,
    player_id: s.player_id,
    hole_number: s.hole_number,
    gross_strokes: s.gross_score ?? s.gross_strokes,
  }))
  const { error } = await supabase
    .from('scores')
    .upsert(rows, { onConflict: 'round_id,player_id,hole_number' })
  if (error) throw error
}

// ── Wolf Holes ─────────────────────────────────────────────────────────────
// No carry_value column in DB — carry is computed from hole sequence in memory

export async function getWolfHoles(roundId) {
  const { data, error } = await supabase
    .from('wolf_holes')
    .select('*')
    .eq('round_id', roundId)
    .order('hole_number')
  if (error) throw error
  return data
}

export async function upsertWolfHole({
  roundId, groupNumber, holeNumber,
  wolfPlayerId, partnerPlayerId, declaration,
  baseValue, result,
}) {
  const { MULTIPLIERS } = await import('./gameEngine')
  const multiplier = MULTIPLIERS[declaration] || 1

  const { error } = await supabase
    .from('wolf_holes')
    .upsert(
      {
        round_id: roundId,
        group_number: groupNumber,
        hole_number: holeNumber,
        wolf_player_id: wolfPlayerId,
        partner_player_id: partnerPlayerId || null,
        declaration,
        multiplier,
        base_value: baseValue,
        result: result || null,
      },
      { onConflict: 'round_id,group_number,hole_number' }
    )
  if (error) throw error
}

// ── Payments ───────────────────────────────────────────────────────────────

export async function getPayments(tripId) {
  const { data, error } = await supabase
    .from('payments')
    .select('*')
    .eq('trip_id', tripId)
  if (error) throw error
  return data
}

export async function markPayment({ tripId, fromPlayerId, toPlayerId, amount }) {
  const { data, error } = await supabase
    .from('payments')
    .insert({
      trip_id: tripId,
      from_player_id: fromPlayerId,
      to_player_id: toPlayerId,
      amount,
      paid_at: new Date().toISOString(),
    })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deletePayment(paymentId) {
  const { error } = await supabase.from('payments').delete().eq('id', paymentId)
  if (error) throw error
}

// ── User trip history ──────────────────────────────────────────────────────

export async function getTripsForUser(userId) {
  const { data, error } = await supabase
    .from('players')
    .select('id, name, handicap, trip:trips(id, name, join_code, dollar_per_point, created_at)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data // [{ id, name, trip: { id, name, join_code, ... } }]
}

// ── Full trip data fetch ───────────────────────────────────────────────────

export async function loadTripData(tripId) {
  const [players, courses, rounds, payments] = await Promise.all([
    getPlayers(tripId),
    getCourses(tripId),
    getRounds(tripId),
    getPayments(tripId),
  ])
  return { players, courses, rounds, payments }
}

// ── Chip-offs (unresolved skins settled by chip-off after hole 18) ─────────

export async function saveChipOff({ roundId, winnerPlayerId, skinsWon }) {
  const { error } = await supabase
    .from('chip_offs')
    .upsert({ round_id: roundId, winner_player_id: winnerPlayerId, skins_won: skinsWon }, { onConflict: 'round_id' })
  if (error) throw error
}

export async function getChipOffs(roundIds) {
  if (!roundIds.length) return []
  const { data, error } = await supabase
    .from('chip_offs')
    .select('*')
    .in('round_id', roundIds)
  if (error) throw error
  return data
}

// ── All-rounds data (groupings, scores, wolf_holes for every round) ────────

export async function loadAllRoundsData(roundIds) {
  if (!roundIds.length) return { groupings: [], scores: [], wolfHoles: [], chipOffs: [] }
  const [groupRes, scoreRes, wolfRes, chipRes] = await Promise.all([
    supabase.from('groupings').select('*, player:players(*)').in('round_id', roundIds).order('group_number').order('wolf_order'),
    supabase.from('scores').select('*').in('round_id', roundIds).order('hole_number'),
    supabase.from('wolf_holes').select('*').in('round_id', roundIds).order('hole_number'),
    supabase.from('chip_offs').select('*').in('round_id', roundIds),
  ])
  if (groupRes.error) throw groupRes.error
  if (scoreRes.error) throw scoreRes.error
  if (wolfRes.error) throw wolfRes.error
  if (chipRes.error) throw chipRes.error
  return { groupings: groupRes.data, scores: scoreRes.data, wolfHoles: wolfRes.data, chipOffs: chipRes.data }
}

// Save a named course placeholder (no holes) — holes added later via Scan
export async function saveCourseStub({ tripId, name, roundNumber }) {
  if (!name?.trim()) return null
  const { data: course, error } = await supabase
    .from('courses')
    .upsert(
      { trip_id: tripId, name: name.trim(), round_number: roundNumber },
      { onConflict: 'trip_id,round_number' }
    )
    .select()
    .single()
  if (error) throw error
  return course
}

// Copy an existing course's holes to a new round number
export async function copyCourseForRound(tripId, fromRoundNumber, toRoundNumber) {
  const { data: src, error } = await supabase
    .from('courses')
    .select('*, holes(*)')
    .eq('trip_id', tripId)
    .eq('round_number', fromRoundNumber)
    .single()
  if (error) throw error
  const holes = src.holes.map((h) => ({
    holeNumber: h.hole_number,
    par: h.par,
    strokeIndex: h.stroke_index,
    yards: h.yards,
  }))
  return saveCourse({ tripId, name: src.name, roundNumber: toRoundNumber, holes })
}

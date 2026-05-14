import { supabase } from './supabase'

// ── Trips ──────────────────────────────────────────────────────────────────

export async function getTripByCode(joinCode) {
  const { data, error } = await supabase
    .from('trips')
    .select('*')
    .eq('join_code', joinCode.toUpperCase())
    .single()
  if (error && error.code !== 'PGRST116') throw error
  return data
}

export async function createTrip({ name, joinCode, dollarPerPoint = 1 }) {
  const { data, error } = await supabase
    .from('trips')
    .insert({ name, join_code: joinCode.toUpperCase(), dollar_per_point: dollarPerPoint })
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

export async function createPlayer({ tripId, name, handicap = 0, isAdmin = false }) {
  const { data, error } = await supabase
    .from('players')
    .insert({ trip_id: tripId, name, handicap, is_admin: isAdmin })
    .select()
    .single()
  if (error) throw error
  return data
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
  // upsert course
  const { data: course, error: cErr } = await supabase
    .from('courses')
    .upsert(
      { trip_id: tripId, name, round_number: roundNumber },
      { onConflict: 'trip_id,round_number' }
    )
    .select()
    .single()
  if (cErr) throw cErr

  // delete old holes then insert fresh
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

export async function createOrUpdateRound({ tripId, roundNumber, courseId, date, status = 'pending' }) {
  const { data, error } = await supabase
    .from('rounds')
    .upsert(
      { trip_id: tripId, round_number: roundNumber, course_id: courseId, date, status },
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

// ── Groupings ──────────────────────────────────────────────────────────────
// One row per player per round: which group + wolf position

export async function getGroupings(roundId) {
  const { data, error } = await supabase
    .from('groupings')
    .select('*, player:players(*)')
    .eq('round_id', roundId)
    .order('group_number')
    .order('wolf_position')
  if (error) throw error
  return data
}

export async function saveGroupings(roundId, groupingsArray) {
  // groupingsArray: [{ playerId, groupNumber, wolfPosition }]
  await supabase.from('groupings').delete().eq('round_id', roundId)
  if (!groupingsArray.length) return

  const rows = groupingsArray.map((g) => ({
    round_id: roundId,
    player_id: g.playerId,
    group_number: g.groupNumber,
    wolf_position: g.wolfPosition,
  }))
  const { error } = await supabase.from('groupings').insert(rows)
  if (error) throw error
}

// ── Scores ─────────────────────────────────────────────────────────────────

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
      { round_id: roundId, player_id: playerId, hole_number: holeNumber, gross_score: grossScore },
      { onConflict: 'round_id,player_id,hole_number' }
    )
  if (error) throw error
}

// Batch upsert multiple scores at once
export async function upsertScores(scores) {
  if (!scores.length) return
  const { error } = await supabase
    .from('scores')
    .upsert(scores, { onConflict: 'round_id,player_id,hole_number' })
  if (error) throw error
}

// ── Wolf Holes ─────────────────────────────────────────────────────────────

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
  baseValue, carryValue, result,
}) {
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
        base_value: baseValue,
        carry_value: carryValue,
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

export async function markPayment({ tripId, fromPlayerId, toPlayerId, amount, note }) {
  const { data, error } = await supabase
    .from('payments')
    .insert({
      trip_id: tripId,
      from_player_id: fromPlayerId,
      to_player_id: toPlayerId,
      amount,
      note: note || null,
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

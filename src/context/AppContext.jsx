import { createContext, useContext, useEffect, useReducer, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { getTripByCode, loadTripData, getPlayers, getGroupings, getScores, getWolfHoles } from '../lib/db'
import { flushQueue } from '../lib/offline'

const AppContext = createContext(null)

const LOCAL_KEYS = {
  joinCode: 'wolf_golf_join_code',
  tripId: 'wolf_golf_trip_id',
  playerId: 'wolf_golf_player_id',
  activeRoundId: 'wolf_golf_active_round_id',
  isAdmin: 'wolf_golf_is_admin',
}

function loadLocal() {
  return {
    joinCode: localStorage.getItem(LOCAL_KEYS.joinCode) || '',
    tripId: localStorage.getItem(LOCAL_KEYS.tripId) || '',
    playerId: localStorage.getItem(LOCAL_KEYS.playerId) || '',
    activeRoundId: localStorage.getItem(LOCAL_KEYS.activeRoundId) || '',
    isAdmin: localStorage.getItem(LOCAL_KEYS.isAdmin) === 'true',
  }
}

const initialState = {
  ...loadLocal(),
  trip: null,
  players: [],
  courses: [],
  rounds: [],
  payments: [],
  groupings: [],     // for active round
  scores: [],        // for active round
  wolfHoles: [],     // for active round
  loading: true,
  error: null,
}

function reducer(state, action) {
  switch (action.type) {
    case 'SET_LOADING': return { ...state, loading: action.value }
    case 'SET_ERROR': return { ...state, error: action.value, loading: false }
    case 'SET_TRIP_DATA':
      return { ...state, ...action.payload, loading: false, error: null }
    case 'SET_ROUND_DATA':
      return { ...state, ...action.payload }
    case 'SET_PLAYER_ID': {
      localStorage.setItem(LOCAL_KEYS.playerId, action.value)
      return { ...state, playerId: action.value }
    }
    case 'SET_JOIN_INFO': {
      localStorage.setItem(LOCAL_KEYS.joinCode, action.joinCode)
      localStorage.setItem(LOCAL_KEYS.tripId, action.tripId)
      return { ...state, joinCode: action.joinCode, tripId: action.tripId }
    }
    case 'SET_ACTIVE_ROUND': {
      localStorage.setItem(LOCAL_KEYS.activeRoundId, action.roundId)
      return { ...state, activeRoundId: action.roundId }
    }
    case 'SET_ADMIN': {
      localStorage.setItem(LOCAL_KEYS.isAdmin, String(action.value))
      return { ...state, isAdmin: action.value }
    }
    case 'UPSERT_SCORE': {
      const { roundId, playerId, holeNumber, grossScore } = action
      const existing = state.scores.findIndex(
        (s) => s.round_id === roundId && s.player_id === playerId && s.hole_number === holeNumber
      )
      const newScore = { round_id: roundId, player_id: playerId, hole_number: holeNumber, gross_strokes: grossScore }
      const scores = existing >= 0
        ? state.scores.map((s, i) => (i === existing ? newScore : s))
        : [...state.scores, newScore]
      return { ...state, scores }
    }
    case 'UPSERT_WOLF_HOLE': {
      const wh = action.wolfHole
      const existing = state.wolfHoles.findIndex(
        (w) => w.round_id === wh.round_id && w.group_number === wh.group_number && w.hole_number === wh.hole_number
      )
      const wolfHoles = existing >= 0
        ? state.wolfHoles.map((w, i) => (i === existing ? wh : w))
        : [...state.wolfHoles, wh]
      return { ...state, wolfHoles }
    }
    case 'SET_PLAYERS': return { ...state, players: action.players }
    case 'SET_PAYMENTS': return { ...state, payments: action.payments }
    case 'CLEAR_SESSION': {
      Object.values(LOCAL_KEYS).forEach((k) => localStorage.removeItem(k))
      return { ...initialState, ...loadLocal(), loading: false }
    }
    default: return state
  }
}

export function AppProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState)

  const loadRoundData = useCallback(async (roundId) => {
    if (!roundId) return
    const [groupings, scores, wolfHoles] = await Promise.all([
      getGroupings(roundId),
      getScores(roundId),
      getWolfHoles(roundId),
    ])
    dispatch({ type: 'SET_ROUND_DATA', payload: { groupings, scores, wolfHoles } })
  }, [])

  const loadTrip = useCallback(async (tripId, roundId) => {
    dispatch({ type: 'SET_LOADING', value: true })
    try {
      const { players, courses, rounds, payments } = await loadTripData(tripId)
      const trip = { id: tripId }

      const activeRound = roundId
        ? rounds.find((r) => r.id === roundId)
        : rounds.find((r) => r.status === 'active') || rounds[rounds.length - 1]

      dispatch({ type: 'SET_TRIP_DATA', payload: { trip, players, courses, rounds, payments } })

      if (activeRound) {
        dispatch({ type: 'SET_ACTIVE_ROUND', roundId: activeRound.id })
        await loadRoundData(activeRound.id)
      }
    } catch (e) {
      dispatch({ type: 'SET_ERROR', value: e.message })
    }
  }, [loadRoundData])

  // Initial load from localStorage
  useEffect(() => {
    const { tripId, activeRoundId } = loadLocal()
    if (tripId) {
      loadTrip(tripId, activeRoundId)
    } else {
      dispatch({ type: 'SET_LOADING', value: false })
    }
  }, [loadTrip])

  // Realtime subscriptions
  useEffect(() => {
    if (!state.tripId) return

    const channel = supabase
      .channel(`trip-${state.tripId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'scores' }, (payload) => {
        const s = payload.new
        if (s && s.round_id === state.activeRoundId) {
          dispatch({ type: 'UPSERT_SCORE', ...s, roundId: s.round_id, playerId: s.player_id, holeNumber: s.hole_number, grossScore: s.gross_strokes })
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wolf_holes' }, (payload) => {
        const wh = payload.new
        if (wh && wh.round_id === state.activeRoundId) {
          dispatch({ type: 'UPSERT_WOLF_HOLE', wolfHole: wh })
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payments' }, () => {
        // Reload payments
        loadTripData(state.tripId).then(({ payments }) => dispatch({ type: 'SET_PAYMENTS', payments }))
      })
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [state.tripId, state.activeRoundId])

  // Periodic flush
  useEffect(() => {
    const id = setInterval(() => flushQueue(), 15000)
    return () => clearInterval(id)
  }, [])

  const actions = {
    async joinTrip(joinCode) {
      const trip = await getTripByCode(joinCode)
      if (!trip) throw new Error('Trip not found. Check your join code.')
      dispatch({ type: 'SET_JOIN_INFO', joinCode, tripId: trip.id })
      await loadTrip(trip.id)
      return trip
    },
    setPlayerId(playerId) {
      dispatch({ type: 'SET_PLAYER_ID', value: playerId })
    },
    setTrip(trip) {
      dispatch({ type: 'SET_JOIN_INFO', joinCode: trip.join_code, tripId: trip.id })
    },
    setAdmin(value) {
      dispatch({ type: 'SET_ADMIN', value })
    },
    setActiveRound(roundId) {
      dispatch({ type: 'SET_ACTIVE_ROUND', roundId })
      loadRoundData(roundId)
    },
    async reload() {
      await loadTrip(state.tripId, state.activeRoundId)
    },
    async reloadPlayers() {
      const players = await getPlayers(state.tripId)
      dispatch({ type: 'SET_PLAYERS', players })
    },
    updateScore(roundId, playerId, holeNumber, grossScore) {
      dispatch({ type: 'UPSERT_SCORE', roundId, playerId, holeNumber, grossScore })
    },
    updateWolfHole(wolfHole) {
      dispatch({ type: 'UPSERT_WOLF_HOLE', wolfHole })
    },
    clearSession() {
      dispatch({ type: 'CLEAR_SESSION' })
    },
  }

  return (
    <AppContext.Provider value={{ state, actions }}>
      {children}
    </AppContext.Provider>
  )
}

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be inside AppProvider')
  return ctx
}

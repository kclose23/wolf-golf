import { createContext, useContext, useEffect, useReducer, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { getTripByCode, getTrip, loadTripData, loadAllRoundsData, getPlayers } from '../lib/db'
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
  user: null,
  authLoading: true,
  trip: null,
  players: [],
  courses: [],
  rounds: [],
  payments: [],
  groupings: [],
  scores: [],
  wolfHoles: [],
  chipOffs: [],
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
    case 'UPSERT_CHIP_OFF': {
      const co = action.chipOff
      const existing = state.chipOffs.findIndex((c) => c.round_id === co.round_id)
      const chipOffs = existing >= 0
        ? state.chipOffs.map((c, i) => (i === existing ? co : c))
        : [...state.chipOffs, co]
      return { ...state, chipOffs }
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
    case 'SET_USER':
      return { ...state, user: action.user, authLoading: false }
    case 'CLEAR_SESSION': {
      Object.values(LOCAL_KEYS).forEach((k) => localStorage.removeItem(k))
      return {
        ...state,
        joinCode: '', tripId: '', playerId: '', activeRoundId: '', isAdmin: false,
        trip: null, players: [], courses: [], rounds: [], payments: [],
        groupings: [], scores: [], wolfHoles: [],
        loading: false,
      }
    }
    default: return state
  }
}

export function AppProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState)

  const loadTrip = useCallback(async (tripId, roundId) => {
    dispatch({ type: 'SET_LOADING', value: true })
    try {
      const [{ data: { session } }, trip, { players, courses, rounds, payments }] = await Promise.all([
        supabase.auth.getSession(),
        getTrip(tripId),
        loadTripData(tripId),
      ])

      // Prefer the explicitly-requested round; otherwise pick the highest-numbered active round
      const activeRound = roundId
        ? rounds.find((r) => r.id === roundId)
        : [...rounds].sort((a, b) => b.round_number - a.round_number).find((r) => r.status === 'active')
          || [...rounds].sort((a, b) => b.round_number - a.round_number)[0]

      const allRoundData = rounds.length > 0
        ? await loadAllRoundsData(rounds.map((r) => r.id))
        : { groupings: [], scores: [], wolfHoles: [] }

      // Detect admin: match by saved playerId OR by authenticated user ID.
      // Using auth user ID means admin is always detected even after localStorage is wiped.
      const savedPlayerId = localStorage.getItem('wolf_golf_player_id')
      const authUserId = session?.user?.id
      const me = players.find((p) =>
        (savedPlayerId && p.id === savedPlayerId) ||
        (authUserId && p.user_id === authUserId)
      )
      const isAdmin = me?.is_admin === true
      if (isAdmin) localStorage.setItem('wolf_golf_is_admin', 'true')

      dispatch({
        type: 'SET_TRIP_DATA',
        payload: {
          trip, players, courses, rounds, payments, ...allRoundData,
          ...(isAdmin ? { isAdmin: true } : {}),
        },
      })

      if (activeRound) {
        dispatch({ type: 'SET_ACTIVE_ROUND', roundId: activeRound.id })
      }
    } catch (e) {
      dispatch({ type: 'SET_ERROR', value: e.message })
    }
  }, [])

  // Auth initialization
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      dispatch({ type: 'SET_USER', user: session?.user || null })
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      dispatch({ type: 'SET_USER', user: session?.user || null })
    })
    return () => subscription.unsubscribe()
  }, [])

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
    const tripId = state.tripId

    const channel = supabase
      .channel(`trip-${tripId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'scores' }, (payload) => {
        const s = payload.new
        if (s) {
          dispatch({ type: 'UPSERT_SCORE', roundId: s.round_id, playerId: s.player_id, holeNumber: s.hole_number, grossScore: s.gross_strokes })
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wolf_holes' }, (payload) => {
        const wh = payload.new
        if (wh) {
          dispatch({ type: 'UPSERT_WOLF_HOLE', wolfHole: wh })
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chip_offs' }, (payload) => {
        const co = payload.new
        if (co) dispatch({ type: 'UPSERT_CHIP_OFF', chipOff: co })
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payments' }, () => {
        loadTripData(tripId).then(({ payments }) => dispatch({ type: 'SET_PAYMENTS', payments }))
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rounds', filter: `trip_id=eq.${tripId}` }, () => {
        // Round created or status changed (pending→active) — reload so every device syncs
        loadTrip(tripId, null)
      })
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [state.tripId, loadTrip])

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
    updateChipOff(chipOff) {
      dispatch({ type: 'UPSERT_CHIP_OFF', chipOff })
    },
    clearSession() {
      dispatch({ type: 'CLEAR_SESSION' })
    },
    async signOut() {
      localStorage.removeItem('wolf_golf_skip_auth')
      await supabase.auth.signOut()
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

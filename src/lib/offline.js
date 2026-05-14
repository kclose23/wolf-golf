import { upsertScores, upsertWolfHole } from './db'

const QUEUE_KEY = 'wolf_golf_sync_queue'

function readQueue() {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]')
  } catch {
    return []
  }
}

function writeQueue(q) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(q))
}

function enqueue(item) {
  const q = readQueue()
  // deduplicate: replace matching key
  const idx = q.findIndex((x) => x.key === item.key)
  if (idx >= 0) q[idx] = item
  else q.push(item)
  writeQueue(q)
}

// ── Score writes ───────────────────────────────────────────────────────────

export function queueScore({ roundId, playerId, holeNumber, grossScore }) {
  const key = `score:${roundId}:${playerId}:${holeNumber}`
  enqueue({ key, type: 'score', data: { roundId, playerId, holeNumber, grossScore } })
}

export function queueWolfHole(wolfHoleData) {
  const key = `wolf:${wolfHoleData.roundId}:${wolfHoleData.groupNumber}:${wolfHoleData.holeNumber}`
  enqueue({ key, type: 'wolfHole', data: wolfHoleData })
}

// ── Flush ──────────────────────────────────────────────────────────────────

let flushing = false

export async function flushQueue() {
  if (flushing || !navigator.onLine) return
  const q = readQueue()
  if (!q.length) return

  flushing = true
  const failed = []

  // Batch scores together for efficiency
  const scoreItems = q.filter((x) => x.type === 'score')
  const wolfItems = q.filter((x) => x.type === 'wolfHole')
  const otherItems = q.filter((x) => x.type !== 'score' && x.type !== 'wolfHole')

  try {
    if (scoreItems.length) {
      await upsertScores(
        scoreItems.map((x) => ({
          round_id: x.data.roundId,
          player_id: x.data.playerId,
          hole_number: x.data.holeNumber,
          gross_score: x.data.grossScore,
        }))
      )
    }
  } catch {
    failed.push(...scoreItems)
  }

  for (const item of wolfItems) {
    try {
      await upsertWolfHole(item.data)
    } catch {
      failed.push(item)
    }
  }

  for (const item of otherItems) {
    failed.push(item) // unknown type — keep in queue
  }

  writeQueue(failed)
  flushing = false
  return failed.length === 0
}

export function queueSize() {
  return readQueue().length
}

// Auto-flush on reconnect
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => flushQueue())
}

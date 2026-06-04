import { useState, useRef } from 'react'
import { useApp } from '../context/AppContext'
import { saveCourse, copyCourseForRound } from '../lib/db'
import Layout from '../components/Layout'
import Spinner from '../components/Spinner'

export default function CourseScanScreen({ onBack, onSaved }) {
  const { state, actions } = useApp()
  const { tripId, rounds, courses, activeRoundId } = state
  const fileRef = useRef()

  const activeRound = rounds.find((r) => r.id === activeRoundId)
  const roundNumber = activeRound?.round_number || 1

  const previousCourses = courses.filter((c) => c.round_number !== roundNumber && c.holes?.length > 0)

  // Loaded hole data (from any source)
  const [courseName, setCourseName] = useState('')
  const [holes, setHoles] = useState([])
  const [dataSource, setDataSource] = useState(null) // 'search' | 'scan' | 'manual'

  // Search state
  const [searchQuery, setSearchQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchResults, setSearchResults] = useState(null) // null=not searched, []=no results

  // Scan state
  const [scanning, setScanning] = useState(false)
  const [imagePreview, setImagePreview] = useState(null)

  // Save / copy state
  const [saving, setSaving] = useState(false)
  const [copying, setCopying] = useState(false)
  const [error, setError] = useState('')

  const hasHoles = holes.length === 9 || holes.length === 18

  // ── Search ─────────────────────────────────────────────────────────────

  async function handleSearch(e) {
    e.preventDefault()
    if (!searchQuery.trim()) return
    setSearching(true)
    setError('')
    setSearchResults(null)
    try {
      const res = await fetch('/api/search-course', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: searchQuery.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Search failed')
      setSearchResults(data.courses || [])
    } catch (err) {
      setError(err.message)
    } finally {
      setSearching(false)
    }
  }

  function selectSearchResult(course) {
    const name = course.facility && course.facility !== course.name
      ? `${course.name} — ${course.facility}`
      : course.name
    setCourseName(name)
    setHoles(course.holes)
    setDataSource('search')
    setSearchResults(null)
  }

  // ── Scan ───────────────────────────────────────────────────────────────

  async function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setError('')
    setScanning(true)
    try {
      const base64 = await fileToBase64(file)
      const mediaType = file.type || 'image/jpeg'
      setImagePreview(URL.createObjectURL(file))

      const res = await fetch('/api/scan-scorecard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: base64, mediaType }),
      })
      let data
      try { data = await res.json() } catch { throw new Error('Scan API unreachable.') }
      if (!res.ok) throw new Error(data.error || 'Scan failed')

      setCourseName(data.courseName || '')
      setHoles(data.holes || [])
      setDataSource('scan')
    } catch (err) {
      setError(err.message)
    } finally {
      setScanning(false)
    }
  }

  // ── Copy from previous round ───────────────────────────────────────────

  async function handleCopy(fromRoundNumber) {
    setCopying(true)
    setError('')
    try {
      await copyCourseForRound(tripId, fromRoundNumber, roundNumber)
      await actions.reload()
      onSaved()
    } catch (err) {
      setError(err.message)
    } finally {
      setCopying(false)
    }
  }

  // ── Save ───────────────────────────────────────────────────────────────

  async function handleSave() {
    setSaving(true)
    setError('')
    try {
      await saveCourse({ tripId, name: courseName, roundNumber, holes })
      await actions.reload()
      onSaved()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  function updateHole(idx, field, value) {
    setHoles((prev) => prev.map((h, i) => i === idx ? { ...h, [field]: value } : h))
  }

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <Layout title="Add Course" onBack={onBack}>
      <div className="space-y-5">

        {/* ── 1. Search (primary) ── */}
        <div className="space-y-3">
          <form onSubmit={handleSearch} className="flex gap-2">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search course name…"
              className="flex-1 bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-green-500 placeholder-gray-600"
            />
            <button
              type="submit"
              disabled={!searchQuery.trim() || searching}
              className="bg-green-600 text-white px-4 py-3 rounded-xl font-semibold disabled:opacity-50 flex items-center gap-2 shrink-0"
            >
              {searching ? <Spinner size="sm" /> : 'Search'}
            </button>
          </form>

          {/* Search results */}
          {searchResults !== null && (
            searchResults.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-3">
                No results found — try a different spelling or scan the scorecard below.
              </p>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-gray-500 px-1">
                  {searchResults.length} course{searchResults.length !== 1 ? 's' : ''} found — tap to select
                </p>
                {searchResults.map((course, i) => {
                  const totalPar = course.holes.reduce((s, h) => s + (h.par || 0), 0)
                  return (
                    <button
                      key={i}
                      onClick={() => selectSearchResult(course)}
                      className="w-full bg-gray-800 hover:bg-gray-750 border border-gray-700 hover:border-green-600 rounded-xl px-4 py-3 text-left transition-colors"
                    >
                      <div className="font-semibold text-white">{course.name}</div>
                      <div className="text-xs text-gray-400 mt-0.5 flex items-center gap-2">
                        {course.facility && course.facility !== course.name && (
                          <span>{course.facility}</span>
                        )}
                        {course.location && <span>{course.location}</span>}
                        <span>{course.holes.length} holes · Par {totalPar}</span>
                      </div>
                    </button>
                  )
                })}
              </div>
            )
          )}
        </div>

        {/* Divider */}
        {!hasHoles && (
          <div className="flex items-center gap-3">
            <div className="flex-1 border-t border-gray-800" />
            <span className="text-xs text-gray-600 uppercase tracking-wide">or</span>
            <div className="flex-1 border-t border-gray-800" />
          </div>
        )}

        {/* ── 2. Copy from previous round ── */}
        {!hasHoles && previousCourses.length > 0 && (
          <div className="bg-gray-800 rounded-xl border border-gray-700 p-4 space-y-2">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Copy from previous round</p>
            <div className="flex flex-col gap-2">
              {previousCourses.map((c) => (
                <button
                  key={c.id}
                  onClick={() => handleCopy(c.round_number)}
                  disabled={copying}
                  className="flex items-center justify-between bg-gray-700 hover:bg-gray-600 rounded-lg px-3 py-2.5 text-sm transition-colors disabled:opacity-50"
                >
                  <span className="font-medium text-gray-200">{c.name || `Round ${c.round_number}`}</span>
                  <span className="text-xs text-gray-400">R{c.round_number} · {c.holes.length} holes →</span>
                </button>
              ))}
            </div>
            {copying && <p className="text-xs text-green-400 text-center">Copying…</p>}
          </div>
        )}

        {/* ── 3. Photo scan ── */}
        {!hasHoles && (
          <>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleFile}
              className="hidden"
            />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={scanning}
              className="w-full border-2 border-dashed border-gray-700 rounded-xl py-6 flex flex-col items-center gap-2 hover:border-green-500 transition-colors disabled:opacity-50"
            >
              {scanning ? (
                <>
                  <Spinner size="lg" />
                  <span className="text-sm text-gray-500">Scanning scorecard…</span>
                </>
              ) : (
                <>
                  <span className="text-3xl">📷</span>
                  <span className="text-sm font-medium text-gray-300">Scan physical scorecard</span>
                  <span className="text-xs text-gray-500">Photo the card — Claude reads it automatically</span>
                </>
              )}
            </button>

            {imagePreview && !scanning && (
              <img src={imagePreview} alt="Scorecard" className="w-full rounded-lg object-contain max-h-48" />
            )}
          </>
        )}

        {/* ── 4. Manual entry ── */}
        {!hasHoles && !scanning && (
          <div className="flex gap-2 justify-center">
            {[9, 18].map((n) => (
              <button
                key={n}
                onClick={() => {
                  setHoles(Array.from({ length: n }, (_, i) => ({
                    holeNumber: i + 1, par: 4, strokeIndex: i + 1, yards: null,
                  })))
                  setDataSource('manual')
                }}
                className="text-sm text-gray-500 underline py-2 px-2"
              >
                Enter {n} holes manually
              </button>
            ))}
          </div>
        )}

        {/* ── Error ── */}
        {error && (
          <div className="bg-red-900/40 border border-red-800 rounded-lg p-3 text-sm text-red-400">
            {error}
          </div>
        )}

        {/* ── 5. Hole review + save ── */}
        {hasHoles && (
          <div className="space-y-3">
            {dataSource === 'search' && (
              <div className="bg-blue-900/20 border border-blue-800/50 rounded-lg px-3 py-2 text-xs text-blue-300">
                Data sourced from Claude's course knowledge — review holes below before saving.
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">Course Name</label>
              <input
                type="text"
                value={courseName}
                onChange={(e) => setCourseName(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>

            <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
              <div className="grid grid-cols-4 px-3 py-2 text-xs font-semibold text-gray-400 bg-gray-700">
                <span>Hole</span>
                <span className="text-center">Par</span>
                <span className="text-center">S.I.</span>
                <span className="text-right pr-2">Yards</span>
              </div>
              <div className="divide-y divide-gray-700 max-h-72 overflow-y-auto">
                {holes.map((h, i) => (
                  <div key={i} className="grid grid-cols-4 px-3 py-2 items-center">
                    <span className="text-sm font-medium text-gray-300">{h.holeNumber}</span>
                    <input
                      type="number"
                      value={h.par}
                      onChange={(e) => updateHole(i, 'par', parseInt(e.target.value))}
                      className="text-center text-sm bg-transparent text-white border-0 focus:ring-1 focus:ring-green-500 rounded w-12 mx-auto"
                      min={3} max={5}
                    />
                    <input
                      type="number"
                      value={h.strokeIndex}
                      onChange={(e) => updateHole(i, 'strokeIndex', parseInt(e.target.value))}
                      className="text-center text-sm bg-transparent text-white border-0 focus:ring-1 focus:ring-green-500 rounded w-12 mx-auto"
                      min={1} max={18}
                    />
                    <span className="text-right pr-2 text-sm text-gray-500">{h.yards || '—'}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => { setHoles([]); setCourseName(''); setDataSource(null); setSearchResults(null) }}
                className="px-4 py-3 rounded-lg border border-gray-700 text-gray-400 text-sm font-medium"
              >
                ← Change
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !courseName.trim()}
                className="flex-1 bg-green-600 text-white py-3 rounded-lg font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {saving ? <Spinner size="sm" /> : 'Save Course'}
              </button>
            </div>
          </div>
        )}
      </div>
    </Layout>
  )
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => resolve(e.target.result.split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

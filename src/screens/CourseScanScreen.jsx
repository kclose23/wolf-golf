import { useState, useRef } from 'react'
import { useApp } from '../context/AppContext'
import { saveCourse } from '../lib/db'
import Layout from '../components/Layout'
import Spinner from '../components/Spinner'

export default function CourseScanScreen({ onBack, onSaved }) {
  const { state, actions } = useApp()
  const { tripId, rounds, activeRoundId } = state
  const fileRef = useRef()

  const activeRound = rounds.find((r) => r.id === activeRoundId)
  const roundNumber = activeRound?.round_number || 1

  const [courseName, setCourseName] = useState('')
  const [holes, setHoles] = useState([])
  const [scanning, setScanning] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [imagePreview, setImagePreview] = useState(null)

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
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Scan failed')

      setCourseName(data.courseName || '')
      setHoles(data.holes || [])
    } catch (err) {
      setError(err.message)
    } finally {
      setScanning(false)
    }
  }

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

  return (
    <Layout title="Scan Scorecard" onBack={onBack}>
      <div className="space-y-4">
        <p className="text-sm text-gray-500">
          Photo the physical scorecard. Claude will extract 9 or 18 holes automatically.
        </p>

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
          className="w-full border-2 border-dashed border-gray-300 rounded-xl py-8 flex flex-col items-center gap-2 hover:border-green-400 transition-colors disabled:opacity-50"
        >
          {scanning ? (
            <>
              <Spinner size="lg" />
              <span className="text-sm text-gray-500">Scanning scorecard…</span>
            </>
          ) : (
            <>
              <span className="text-4xl">📷</span>
              <span className="text-sm font-medium text-gray-600">Tap to photo scorecard</span>
              <span className="text-xs text-gray-400">or select from library</span>
            </>
          )}
        </button>

        {imagePreview && !scanning && (
          <img src={imagePreview} alt="Scorecard" className="w-full rounded-lg object-contain max-h-48" />
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {(holes.length === 9 || holes.length === 18) && (
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Course Name</label>
              <input
                type="text"
                value={courseName}
                onChange={(e) => setCourseName(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>

            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="grid grid-cols-4 px-3 py-2 text-xs font-semibold text-gray-500 bg-gray-50">
                <span>Hole</span>
                <span className="text-center">Par</span>
                <span className="text-center">S.I.</span>
                <span className="text-right">Yards</span>
              </div>
              <div className="divide-y divide-gray-100 max-h-72 overflow-y-auto">
                {holes.map((h, i) => (
                  <div key={i} className="grid grid-cols-4 px-3 py-2 items-center">
                    <span className="text-sm font-medium text-gray-600">{h.holeNumber}</span>
                    <input
                      type="number"
                      value={h.par}
                      onChange={(e) => updateHole(i, 'par', parseInt(e.target.value))}
                      className="text-center text-sm border-0 focus:ring-1 focus:ring-green-500 rounded w-12 mx-auto"
                      min={3} max={5}
                    />
                    <input
                      type="number"
                      value={h.strokeIndex}
                      onChange={(e) => updateHole(i, 'strokeIndex', parseInt(e.target.value))}
                      className="text-center text-sm border-0 focus:ring-1 focus:ring-green-500 rounded w-12 mx-auto"
                      min={1} max={18}
                    />
                    <span className="text-right text-sm text-gray-500">{h.yards || '—'}</span>
                  </div>
                ))}
              </div>
            </div>

            <button
              onClick={handleSave}
              disabled={saving}
              className="w-full bg-green-600 text-white py-3 rounded-lg font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {saving ? <Spinner size="sm" /> : 'Save Scorecard'}
            </button>
          </div>
        )}

        {/* Manual entry fallback */}
        {holes.length === 0 && !scanning && (
          <div className="flex gap-2 justify-center">
            {[9, 18].map((n) => (
              <button
                key={n}
                onClick={() =>
                  setHoles(
                    Array.from({ length: n }, (_, i) => ({
                      holeNumber: i + 1,
                      par: 4,
                      strokeIndex: i + 1,
                      yards: null,
                    }))
                  )
                }
                className="text-sm text-gray-400 underline text-center py-2 px-2"
              >
                Enter {n} holes manually
              </button>
            ))}
          </div>
        )}
      </div>
    </Layout>
  )
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const result = e.target.result
      // Strip the data URL prefix
      const base64 = result.split(',')[1]
      resolve(base64)
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

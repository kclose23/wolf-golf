import Anthropic from '@anthropic-ai/sdk'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { query } = req.body
  if (!query?.trim()) {
    return res.status(400).json({ error: 'query is required' })
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  try {
    const message = await client.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: `You are a golf course database. Look up hole-by-hole scorecard data for golf courses matching this search: "${query.trim()}"

Return ONLY a JSON array (no markdown, no explanation) of matching courses. Each element:
{
  "name": "Course name (e.g. Big Meadow)",
  "facility": "Resort/club name if applicable (e.g. Black Butte Ranch), else same as name",
  "location": "City, State",
  "holes": [
    { "holeNumber": 1, "par": 4, "strokeIndex": 7, "yards": 385 }
  ]
}

Rules:
- If the facility has multiple courses (e.g. a resort with two 18-hole layouts), return each as a separate entry
- holes array must be exactly 9 or 18 entries
- strokeIndex: 1 = hardest, 18 = easiest (for 18 holes); 1–9 for 9-hole courses
- yards: use middle/white tee if multiple tees; null if unknown
- Only return courses you have reliable data for — return [] if no confident match
- Stroke index is important for handicap calculations; use your best knowledge or estimate based on par/difficulty if not certain`,
        },
      ],
    })

    const text = message.content[0].text.trim()

    let courses
    try {
      courses = JSON.parse(text)
    } catch {
      const match = text.match(/\[[\s\S]*\]/)
      if (match) {
        courses = JSON.parse(match[0])
      } else {
        throw new Error('Could not parse response as JSON')
      }
    }

    if (!Array.isArray(courses)) {
      return res.status(422).json({ error: 'Unexpected response format', raw: text })
    }

    // Validate and normalize each course
    const valid = courses.filter((c) => {
      if (!c.name || !Array.isArray(c.holes)) return false
      if (c.holes.length !== 9 && c.holes.length !== 18) return false
      return true
    })

    return res.status(200).json({ courses: valid })
  } catch (err) {
    console.error('search-course error:', err)
    return res.status(500).json({ error: err.message || 'Internal server error' })
  }
}

import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { imageBase64, mediaType = 'image/jpeg' } = req.body

  if (!imageBase64) {
    return res.status(400).json({ error: 'imageBase64 is required' })
  }

  try {
    const message = await client.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: imageBase64 },
            },
            {
              type: 'text',
              text: `Extract the scorecard data from this golf scorecard image and return it as JSON.

Return ONLY a JSON object with this exact structure (no markdown, no explanation):
{
  "courseName": "string",
  "holes": [
    {
      "holeNumber": 1,
      "par": 4,
      "strokeIndex": 7,
      "yards": 385
    }
  ]
}

Rules:
- Include ALL holes shown — either 9 or 18 depending on the scorecard
- strokeIndex is the handicap/stroke index (1=hardest, 18=easiest for 18 holes; 1=hardest, 9=easiest for 9 holes) — often labeled "Stroke Index", "S.I.", or "Hdcp"
- If strokeIndex is not visible, estimate based on hole difficulty (use hole number as fallback)
- Use the white/regular tee yardage if multiple tees shown
- If courseName is not visible use "Course"`,
            },
          ],
        },
      ],
    })

    const text = message.content[0].text.trim()

    let parsed
    try {
      parsed = JSON.parse(text)
    } catch {
      // Claude sometimes wraps in markdown — strip it
      const match = text.match(/```(?:json)?\s*([\s\S]+?)\s*```/)
      if (match) {
        parsed = JSON.parse(match[1])
      } else {
        throw new Error('Could not parse Claude response as JSON')
      }
    }

    if (!parsed.holes || (parsed.holes.length !== 9 && parsed.holes.length !== 18)) {
      return res.status(422).json({
        error: `Expected 9 or 18 holes but got ${parsed.holes?.length ?? 0}. Try a clearer photo.`,
        raw: text,
      })
    }

    return res.status(200).json(parsed)
  } catch (err) {
    console.error('scan-scorecard error:', err)
    return res.status(500).json({ error: err.message || 'Internal server error' })
  }
}

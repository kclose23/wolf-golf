// Runs the Vercel serverless API handlers locally inside the Vite dev server,
// so you don't need `vercel dev` or a separate process.

export function apiDevPlugin() {
  let scanHandler = null

  return {
    name: 'api-dev-middleware',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/scan-scorecard', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.setHeader('Content-Type', 'application/json')
          return res.end(JSON.stringify({ error: 'Method not allowed' }))
        }

        // Collect request body
        let raw = ''
        for await (const chunk of req) raw += chunk.toString()

        // Vercel-style req shim
        const vercelReq = {
          method: req.method,
          headers: req.headers,
          body: (() => { try { return JSON.parse(raw) } catch { return {} } })(),
        }

        // Vercel-style res shim
        let finished = false
        const vercelRes = {
          _code: 200,
          status(code) { this._code = code; return this },
          json(data) {
            if (finished) return this
            finished = true
            res.statusCode = this._code
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify(data))
            return this
          },
        }

        try {
          if (!scanHandler) {
            const mod = await import('./api/scan-scorecard.js')
            scanHandler = mod.default
          }
          await scanHandler(vercelReq, vercelRes)
        } catch (err) {
          if (!finished) {
            finished = true
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: err.message || 'Internal server error' }))
          }
        }
      })
    },
  }
}

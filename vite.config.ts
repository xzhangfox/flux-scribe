import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'

// In development, serve /api/* from the same Web-standard handlers Vercel
// runs in production (api/*.ts export `POST(req: Request)`), so `npm run
// dev` is the whole app — no second server.
function devApi(): Plugin {
  return {
    name: 'scribe-dev-api',
    configureServer(server) {
      server.middlewares.use('/api', async (req, res) => {
        try {
          const name = (req.url || '').split('?')[0].replace(/^\/+/, '')
          if (!/^[\w-]+(\/[\w-]+)?$/.test(name) || name.startsWith('_')) {
            res.statusCode = 404
            return res.end()
          }
          const mod = await server.ssrLoadModule(`/api/${name}.ts`)
          const handler = mod[req.method || 'GET']
          if (typeof handler !== 'function') {
            res.statusCode = 405
            return res.end()
          }
          const chunks: Buffer[] = []
          for await (const c of req) chunks.push(c as Buffer)
          const request = new Request(`http://localhost/api/${name}`, {
            method: req.method,
            headers: req.headers as Record<string, string>,
            body: chunks.length ? Buffer.concat(chunks) : undefined,
          })
          const response: Response = await handler(request)
          res.statusCode = response.status
          response.headers.forEach((v, k) => res.setHeader(k, v))
          res.end(Buffer.from(await response.arrayBuffer()))
        } catch (err) {
          console.error(err)
          res.statusCode = 500
          res.end(JSON.stringify({ error: String(err) }))
        }
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  // Expose .env (GEMINI_API_KEY, SCRIBE_MOCK, SCRIBE_MODEL) to the dev API
  // handlers, which read process.env exactly as they do on Vercel.
  Object.assign(process.env, loadEnv(mode, process.cwd(), ''))
  return { plugins: [react(), devApi()] }
})

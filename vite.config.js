import react from '@vitejs/plugin-react'
import process from 'node:process'
import { defineConfig, loadEnv } from 'vite'

const DEFAULT_API = 'https://pocket-backend-7lmx.onrender.com'

/**
 * Production builds get a strict Content-Security-Policy: scripts only from this site, network
 * only to the Flick API, no plugins, no <base> tricks. (Dev mode skips it: Vite's hot reload
 * needs inline scripts.) Also set the same policy plus `frame-ancestors 'none'` as an HTTP header
 * on your web host, which stops other sites from embedding Flick Web (clickjacking).
 */
function contentSecurityPolicy(apiBase) {
  const api = new URL(apiBase)
  const ws = `${api.protocol === 'https:' ? 'wss:' : 'ws:'}//${api.host}`
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    `connect-src 'self' ${api.origin} ${ws}`,
    `img-src 'self' data: blob: ${api.origin} https:`,
    `media-src 'self' blob: ${api.origin} https:`,
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ')
  return {
    name: 'flick-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`)
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  return {
    plugins: [react(), contentSecurityPolicy(env.VITE_FLICK_API || DEFAULT_API)],
    build: { sourcemap: false },
  }
})

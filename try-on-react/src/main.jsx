import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import {
  StreamVideoClient,
  StreamVideo,
  StreamCall,
} from '@stream-io/video-react-sdk'
import '@stream-io/video-react-sdk/dist/css/styles.css'
import './index.css'
import App from './App.jsx'

// ─── Stream configuration injected at build time by vite.config.js ───────────
const STREAM_API_KEY  = import.meta.env.VITE_STREAM_API_KEY  || ''
const STREAM_CALL_TYPE = import.meta.env.VITE_STREAM_CALL_TYPE || 'default'
const STREAM_CALL_ID  = import.meta.env.VITE_STREAM_CALL_ID  || 'tryon-mirror'
// Use a relative path in dev so Vite's proxy handles /api → Flask without CORS.
// In production set VITE_BACKEND_URL to the full backend origin.
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || ''

// Stable kiosk user ID — in production, derive from session/login
const MIRROR_USER_ID = 'kiosk-mirror-01'

/**
 * Fetch a short-lived JWT from the Flask backend so the frontend never holds
 * the Stream API secret.
 *
 * Uses a relative /api path so the Vite dev-server proxy forwards the request
 * to Flask on port 5000 — no CORS preflight is triggered in the browser.
 * In production, set VITE_BACKEND_URL to your deployed backend origin.
 */
async function fetchStreamToken(userId) {
  // Relative path → Vite proxy handles it in dev; absolute URL in production.
  const base = BACKEND_URL ? BACKEND_URL.replace(/\/$/, '') : ''
  const url  = `${base}/api/auth-mirror`
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId }),
    })
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}))
      throw new Error(errBody.error || `HTTP ${res.status}`)
    }
    return await res.json()
  } catch (err) {
    console.warn('[Stream] Token fetch failed (is try-on-flask running?):', err.message)
    return null
  }
}

/**
 * Bootstrap the Stream client + call, then mount the React tree.
 * We always mount the app — Stream is treated as an enhancement that degrades
 * gracefully when the backend / network is unavailable.
 */
async function bootstrap() {
  let streamClient = null
  let streamCall   = null

  if (STREAM_API_KEY) {
    const tokenData = await fetchStreamToken(MIRROR_USER_ID)

    if (tokenData && tokenData.token) {
      try {
        streamClient = new StreamVideoClient({
          apiKey: tokenData.apiKey || STREAM_API_KEY,
          user: {
            id: tokenData.userId || MIRROR_USER_ID,
            name: 'TryOn Mirror',
            type: 'authenticated',
          },
          token: tokenData.token,
        })

        streamCall = streamClient.call(STREAM_CALL_TYPE, STREAM_CALL_ID)
        await streamCall.join({ create: true })

        // Expose on window so App.jsx event-bridge can still access call directly
        window.streamClient = streamClient
        window.streamCall   = streamCall
      } catch (err) {
        console.error('[Stream] Failed to join call:', err)
        // Clean up any partial state
        try { await streamClient?.disconnectUser() } catch { /* ignore disconnect cleanup errors */ }
        streamClient = null
        streamCall   = null
        window.streamClient = null
        window.streamCall   = null
      }
    } else {
      window.streamClient = null
      window.streamCall   = null
    }
  } else {
    console.warn('[Stream] VITE_STREAM_API_KEY not set — running without Stream.')
    window.streamClient = null
    window.streamCall   = null
  }

  // Mount the React application — always, regardless of Stream status
  const root = createRoot(document.getElementById('root'))

  if (streamClient && streamCall) {
    // Full Stream-connected mode: wrap with context providers so App.jsx can use
    // SDK hooks (useCallStateHooks, useLocalParticipant, etc.)
    root.render(
      <StrictMode>
        <StreamVideo client={streamClient}>
          <StreamCall call={streamCall}>
            <App streamConnected={true} />
          </StreamCall>
        </StreamVideo>
      </StrictMode>,
    )
  } else {
    // Degraded mode: App still works with local camera + event bridge fallback
    root.render(
      <StrictMode>
        <App streamConnected={false} />
      </StrictMode>,
    )
  }
}

bootstrap()

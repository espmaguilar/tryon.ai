import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { StreamVideoClient } from '@stream-io/video-react-sdk'
import './index.css'
import App from './App.jsx'

const STREAM_API_KEY = import.meta.env.VITE_STREAM_API_KEY
const STREAM_USER_ID = import.meta.env.VITE_STREAM_USER_ID
const STREAM_USER_NAME = import.meta.env.VITE_STREAM_USER_NAME || 'TryOn User'
const STREAM_USER_TOKEN = import.meta.env.VITE_STREAM_USER_TOKEN
const STREAM_CALL_TYPE = import.meta.env.VITE_STREAM_CALL_TYPE || 'default'
const STREAM_CALL_ID = import.meta.env.VITE_STREAM_CALL_ID || 'tryon-mirror'

const emitStreamStatus = (status, detail = {}) => {
  window.dispatchEvent(
    new CustomEvent('stream_status', {
      detail: {
        status,
        ...detail,
      },
    }),
  )
}

const mountApp = () => {
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

const joinWithTimeout = async (call, timeoutMs = 8000) => {
  const timeoutPromise = new Promise((_, reject) => {
    window.setTimeout(() => reject(new Error('GetStream join timed out')), timeoutMs)
  })
  return Promise.race([call.join({ create: true }), timeoutPromise])
}

const resetExistingConnection = async () => {
  try {
    if (window.streamCall && typeof window.streamCall.leave === 'function') {
      await window.streamCall.leave()
    }
  } catch {
    // Best-effort cleanup.
  }

  try {
    if (window.streamClient && typeof window.streamClient.disconnectUser === 'function') {
      await window.streamClient.disconnectUser()
    }
  } catch {
    // Best-effort cleanup.
  }

  window.streamClient = null
  window.streamCall = null
}

const bootstrapStream = async () => {
  await resetExistingConnection()

  if (!STREAM_API_KEY || !STREAM_USER_ID || !STREAM_USER_TOKEN) {
    console.warn(
      'GetStream is not configured. Set VITE_STREAM_API_KEY, VITE_STREAM_USER_ID, and VITE_STREAM_USER_TOKEN.',
    )
    emitStreamStatus('offline', { reason: 'missing_env' })
    return
  }

  emitStreamStatus('connecting')

  try {
    const client = new StreamVideoClient({
      apiKey: STREAM_API_KEY,
      user: {
        id: STREAM_USER_ID,
        name: STREAM_USER_NAME,
      },
      token: STREAM_USER_TOKEN,
    })

    const call = client.call(STREAM_CALL_TYPE, STREAM_CALL_ID)
    await joinWithTimeout(call)

    window.streamClient = client
    window.streamCall = call
    emitStreamStatus('online')
  } catch (error) {
    console.error('Failed to initialize GetStream call:', error)
    window.streamClient = null
    window.streamCall = null
    emitStreamStatus('error', { message: error?.message || 'Stream bootstrap failed' })
  }
}

window.reconnectStream = bootstrapStream

mountApp()
bootstrapStream()

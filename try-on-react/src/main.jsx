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

const mountApp = () => {
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

const bootstrapStream = async () => {
  if (!STREAM_API_KEY || !STREAM_USER_ID || !STREAM_USER_TOKEN) {
    console.warn(
      'GetStream is not configured. Set STREAM_API_KEY, VITE_STREAM_USER_ID, and VITE_STREAM_USER_TOKEN.',
    )
    window.streamClient = null
    window.streamCall = null
    return
  }

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
    await call.join({ create: true })

    window.streamClient = client
    window.streamCall = call
  } catch (error) {
    console.error('Failed to initialize GetStream call:', error)
    window.streamClient = null
    window.streamCall = null
  }
}

bootstrapStream().finally(() => {
  mountApp()
})

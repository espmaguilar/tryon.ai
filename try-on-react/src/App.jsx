import { useCallback, useEffect, useRef, useState } from 'react'
import {
  useCallStateHooks,
  ParticipantView,
} from '@stream-io/video-react-sdk'
import './App.css'

// ─── Mock Data ───────────────────────────────────────────────────────────────

const CLOSET_ITEMS = [
  {
    id: 't1',
    name: 'Cyberpunk Bomber',
    category: 'Outerwear',
    price: '$89.00',
    emoji: '🧥',
    imageUrl: 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab',
    productUrl: 'https://www.zara.com/us/en/oversized-bomber-jacket-p01538522.html',
  },
  {
    id: 't2',
    name: 'Classic Denim Jacket',
    category: 'Outerwear',
    price: '$65.00',
    emoji: '🧥',
    imageUrl: 'https://images.unsplash.com/photo-1541099649105-f69ad21f3246',
    productUrl: 'https://www.levi.com/US/en_US/clothing/men/outerwear/the-trucker-jacket/p/723340130',
  },
  {
    id: 't3',
    name: 'Oversized Linen Shirt',
    category: 'Tops',
    price: '$45.00',
    emoji: '👕',
    imageUrl: 'https://images.unsplash.com/photo-1596755094514-f87e34085b2c',
    productUrl: 'https://www.uniqlo.com/us/en/products/E455957-000/00',
  },
  {
    id: 't4',
    name: 'Minimalist Black Tee',
    category: 'Tops',
    price: '$28.00',
    emoji: '👕',
    imageUrl: 'https://images.unsplash.com/photo-1527719327859-c6ce80353573',
    productUrl: 'https://www.everlane.com/products/mens-organic-cotton-box-cut-tee-black',
  },
  {
    id: 't5',
    name: 'Antigravity Space Cape',
    category: 'Outerwear',
    price: '$999.00',
    emoji: '🦸',
    imageUrl: 'https://images.unsplash.com/photo-1516259762381-22954d7d3ad2',
    productUrl: 'https://www.nasa.gov',
  },
  {
    id: 't6',
    name: 'Disco Glow Jacket',
    category: 'Outerwear',
    price: '$120.00',
    emoji: '🪩',
    imageUrl: 'https://images.unsplash.com/photo-1508214751196-bcfd4ca60f91',
    productUrl: 'https://www.ebay.com',
  },
]

const RECOMMENDATIONS = [
  { id: 'r1', name: 'Cargo Joggers',    category: 'Match - 98%', price: '$55.00',  emoji: '👖' },
  { id: 'r2', name: 'Techwear Boots',   category: 'Match - 92%', price: '$120.00', emoji: '🥾' },
  { id: 'r3', name: 'Silver Chain Set', category: 'Match - 85%', price: '$19.00',  emoji: '⛓️' },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

const toCameraErrorMessage = (err) => {
  const code = err?.name || 'UnknownError'
  if (code === 'NotAllowedError' || code === 'SecurityError')
    return 'Camera permission denied. Enable camera access in your browser/site settings.'
  if (code === 'NotFoundError' || code === 'OverconstrainedError')
    return 'No compatible camera device was found.'
  if (code === 'NotReadableError')
    return 'Camera is already in use by another app/tab.'
  return `Could not start camera (${code}).`
}

// ─── Stream video layer (rendered only when SDK context is available) ─────────

/**
 * Renders the local participant's video from GetStream inside the mirror frame.
 * Must be called inside a <StreamCall> context — so it's isolated in its own
 * component and only mounted when `streamConnected` is true.
 */
function StreamMirrorVideo() {
  const { useLocalParticipant } = useCallStateHooks()
  const localParticipant = useLocalParticipant()

  if (!localParticipant) {
    return (
      <div className="camera-placeholder">
        <span style={{ fontSize: '3rem' }}>📡</span>
        <p>Connecting to call…</p>
      </div>
    )
  }

  return (
    <ParticipantView
      participant={localParticipant}
      ParticipantViewUI={null}
      mirror={true}
      muteAudio={true}
      className="stream-participant-view"
    />
  )
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App({ streamConnected = false }) {
  const [activeTab, setActiveTab]               = useState('closet')
  const [selectedItem, setSelectedItem]         = useState(null)
  const [isCameraActive, setIsCameraActive]     = useState(false)
  const [processedImageUrl, setProcessedImageUrl] = useState('')
  const [productUrl, setProductUrl]             = useState('')
  const [, setSyncStatus]                       = useState('DISCONNECTED')
  const [voiceTranscript, setVoiceTranscript]   = useState('')
  const [cameraError, setCameraError]           = useState('')
  const [isCalibrating, setIsCalibrating]       = useState(false)

  const baseImagePath      = (import.meta.env.VITE_BASE_IMAGE_PATH || '').trim()
  const videoRef           = useRef(null)
  const streamRef          = useRef(null)
  const streamListenerReadyRef = useRef(false)
  const requestCounterRef  = useRef(0)
  const latestRequestIdRef = useRef(0)
  const activeRequestIdRef = useRef(null)

  // ── Stream event sender ───────────────────────────────────────────────────

  const sendAgentEvent = useCallback((type, payload) => {
    const call = window.streamCall
    if (call && typeof call.sendCustomEvent === 'function') {
      call.sendCustomEvent({ type, payload })
      setSyncStatus('SYNCED')
      return
    }
    // Fallback bridge for local testing without Stream
    window.dispatchEvent(new CustomEvent('agent_custom_event', { detail: { type, payload } }))
    setSyncStatus('LOCAL_BRIDGE')
  }, [])

  // ── Camera lifecycle (used in degraded / non-Stream mode) ─────────────────

  const stopCamera = useCallback(() => {
    const currentStream = streamRef.current || videoRef.current?.srcObject
    const tracks = currentStream?.getTracks?.() || []
    tracks.forEach((track) => track.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    if (activeRequestIdRef.current != null) {
      sendAgentEvent('cancel_request', {
        request_id: activeRequestIdRef.current,
        reason: 'mirror_power_down',
      })
      activeRequestIdRef.current = null
      setIsCalibrating(false)
    }
    setIsCameraActive(false)
    sendAgentEvent('camera_state',  { is_camera_active: false })
    sendAgentEvent('voice_control', { action: 'stop_transcription', source: 'mirror_power_down' })
  }, [sendAgentEvent])

  const startCamera = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Live camera is not supported in this browser.')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
        audio: false,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        videoRef.current.muted = true
        try { await videoRef.current.play() } catch { /* best-effort */ }
      }
      setIsCameraActive(true)
      setCameraError('')
      sendAgentEvent('camera_state',  { is_camera_active: true })
      sendAgentEvent('voice_control', { action: 'start_transcription', source: 'mirror_initialize' })
    } catch (err) {
      console.error('Error accessing camera:', err)
      setCameraError(toCameraErrorMessage(err))
      stopCamera()
    }
  }, [sendAgentEvent, stopCamera])

  const toggleCamera = useCallback(async () => {
    if (isCameraActive) { stopCamera(); return }
    await startCamera()
  }, [isCameraActive, startCamera, stopCamera])

  // Reconnect stream src after re-render
  useEffect(() => {
    if (isCameraActive && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current
      videoRef.current.muted = true
      videoRef.current.play().catch(() => {})
    }
  }, [isCameraActive])

  // ── Image capture helpers ─────────────────────────────────────────────────

  const capturePoseDataUrl = useCallback(() => {
    if (baseImagePath) return baseImagePath
    const video = videoRef.current
    if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return ''
    const canvas = document.createElement('canvas')
    canvas.width  = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return ''
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/png')
  }, [baseImagePath])

  const handleTakePhoto = useCallback(() => {
    const captured = capturePoseDataUrl()
    if (!captured) return ''
    sendAgentEvent('set_pose_image', { pose_image_url: captured })
    return captured
  }, [capturePoseDataUrl, sendAgentEvent])

  const handleCalibrate = useCallback(() => {
    if (!selectedItem || isCalibrating) return

    const nextRequestId = requestCounterRef.current + 1
    requestCounterRef.current = nextRequestId

    if (activeRequestIdRef.current != null) {
      sendAgentEvent('cancel_request', {
        request_id: activeRequestIdRef.current,
        reason: 'superseded_by_new_calibration',
      })
    }

    latestRequestIdRef.current = nextRequestId
    activeRequestIdRef.current = nextRequestId
    setIsCalibrating(true)

    const poseImageUrl = capturePoseDataUrl()
    sendAgentEvent('set_merchandise', {
      request_id: nextRequestId,
      item_id: selectedItem.id,
      image_url: selectedItem.imageUrl,
      product_url: selectedItem.productUrl,
      item_name: selectedItem.name,
      pose_image_url: poseImageUrl,
      requested_at: Date.now(),
    })
  }, [capturePoseDataUrl, isCalibrating, selectedItem, sendAgentEvent])

  // ── Incoming event listener (Stream custom events + local bridge) ──────────

  useEffect(() => {
    const handleIncomingEvent = (eventType, payload) => {
      if (eventType === 'mirror_update') {
        const incomingRequestIdRaw = payload?.request_id
        const hasIncomingRequestId =
          incomingRequestIdRaw !== undefined &&
          incomingRequestIdRaw !== null &&
          `${incomingRequestIdRaw}`.trim() !== ''
        const incomingRequestId = hasIncomingRequestId ? Number(incomingRequestIdRaw) : null

        if (hasIncomingRequestId && Number.isFinite(incomingRequestId)) {
          if (incomingRequestId < latestRequestIdRef.current) return
          latestRequestIdRef.current = incomingRequestId
          activeRequestIdRef.current = null
          setIsCalibrating(false)
        } else if (isCalibrating) {
          // Backward compatibility: if backend omits request_id, accept update and clear lock.
          activeRequestIdRef.current = null
          setIsCalibrating(false)
        }

        const imageUrl            = payload?.image_url
        const incomingProductUrl  = payload?.product_url
        if (typeof imageUrl === 'string' && imageUrl.trim()) {
          setProcessedImageUrl(imageUrl)
          setSyncStatus('SYNCED')
        }
        setProductUrl(
          typeof incomingProductUrl === 'string' && incomingProductUrl.trim()
            ? incomingProductUrl.trim()
            : ''
        )
      }

      if (eventType === 'voice_command') {
        const transcript = payload?.transcript || payload?.text || payload?.message
        if (typeof transcript === 'string' && transcript.trim()) {
          const normalized = transcript.trim().toLowerCase()
          setVoiceTranscript(transcript.trim())
          setSyncStatus('SYNCED')
          if (normalized.includes('take photo') || normalized.includes('capture photo')) handleTakePhoto()
          if (normalized.includes('calibrate') || normalized.includes('try on') || normalized.includes('try-on')) handleCalibrate()
        }
      }
    }

    const streamCustomHandler = (event) => {
      const customData = event?.custom || {}
      const eventType  = customData?.type || event?.type
      const payload    = customData?.payload || customData?.custom || event?.payload || event?.custom?.payload || {}
      handleIncomingEvent(eventType, payload)
    }

    const localBridgeHandler = (event) => {
      const detail = event?.detail || {}
      handleIncomingEvent(detail?.type, detail?.payload || {})
    }

    window.addEventListener('agent_custom_event', localBridgeHandler)

    const attachStreamListener = () => {
      const call = window.streamCall
      if (!call || typeof call.on !== 'function') return null
      try {
        const maybeUnsubscribe = call.on('custom', streamCustomHandler)
        if (typeof maybeUnsubscribe === 'function') {
          streamListenerReadyRef.current = true
          return maybeUnsubscribe
        }
      } catch { /* best-effort */ }
      return null
    }

    let unsubscribeStream = attachStreamListener()
    let pollTimer = null

    if (!unsubscribeStream) {
      pollTimer = window.setInterval(() => {
        if (streamListenerReadyRef.current) return
        const unsub = attachStreamListener()
        if (unsub) {
          unsubscribeStream = unsub
          window.clearInterval(pollTimer)
        }
      }, 500)
    }

    return () => {
      window.removeEventListener('agent_custom_event', localBridgeHandler)
      if (pollTimer)                              window.clearInterval(pollTimer)
      if (typeof unsubscribeStream === 'function') unsubscribeStream()
    }
  }, [handleCalibrate, handleTakePhoto, isCalibrating])

  // Cleanup camera on unmount
  useEffect(() => () => { stopCamera() }, [stopCamera])

  // ── Determine what is shown in the mirror base layer ─────────────────────
  //
  //  Priority order (highest → lowest):
  //  1. baseImagePath (static image override from env)
  //  2. Stream video call (when streamConnected === true)
  //  3. Local camera (getUserMedia fallback / degraded mode)
  //  4. Offline placeholder
  //
  // When streamConnected is true, the local <video> element and "Initialize Mirror"
  // button are hidden because Stream manages the camera track internally.

  const showLocalCamera   = !streamConnected && !baseImagePath && isCameraActive
  const showStreamVideo   = streamConnected && !baseImagePath

  // In Stream-connected mode, the call is always "active" from the UI's perspective
  const mirrorActive = streamConnected || isCameraActive || !!baseImagePath

  return (
    <div className="app-container">
      <main className="mirror-section">
        <header className="mirror-header">
          <h1>TRY ON AI</h1>
          <p>
            Interactive Smart Mirror System v1.0
            {streamConnected && (
              <span className="stream-status-badge"> · Stream Live</span>
            )}
          </p>
        </header>

        <div className="mirror-view-wrapper">
          {/* ── Base layer: video source ────────────────────────────── */}

          {baseImagePath ? (
            <img src={baseImagePath} alt="Base pose" className="camera-feed" />
          ) : showStreamVideo ? (
            /* GetStream call video — fills the mirror frame */
            <StreamMirrorVideo />
          ) : showLocalCamera ? (
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              className="camera-feed"
            />
          ) : (
            <div className="camera-placeholder">
              <span style={{ fontSize: '3rem' }}>🪞</span>
              <p>Mirror display is offline</p>
            </div>
          )}

          {/* ── Try-on result overlay ────────────────────────────────── */}
          {processedImageUrl ? (
            <img
              src={processedImageUrl}
              alt="Try-on result"
              className="tryon-overlay-image"
              onError={() => setProcessedImageUrl('')}
            />
          ) : null}

          {/* ── HUD overlay (badges, scan-line, controls) ────────────── */}
          <div className="mirror-overlay">
            <div className="overlay-badge">
              <div className="badge-pulse" />
              <span>
                {mirrorActive
                  ? streamConnected
                    ? 'STREAM ACTIVE'
                    : 'SYSTEM ACTIVE'
                  : 'STANDBY'}
              </span>
            </div>

            {mirrorActive && <div className="scan-line" />}

            <div className="mirror-controls">
              {/* Hide Initialize button when Stream is managing the camera */}
              {!streamConnected && (
                <button
                  id="btn-toggle-camera"
                  className="btn"
                  onClick={toggleCamera}
                >
                  {isCameraActive ? 'Power Down Mirror' : 'Initialize Mirror'}
                </button>
              )}

              <button
                id="btn-take-photo"
                className="btn"
                onClick={handleTakePhoto}
                disabled={!mirrorActive}
              >
                Take Photo
              </button>

              <button
                id="btn-calibrate"
                className={`btn btn-primary${!selectedItem || isCalibrating ? ' disabled' : ''}`}
                onClick={handleCalibrate}
                disabled={!selectedItem || isCalibrating}
              >
                {isCalibrating ? 'Calibrating...' : 'Calibrate Fitment'}
              </button>
            </div>

            {voiceTranscript ? (
              <p className="hud-text hud-text--voice">
                Voice command: {voiceTranscript}
              </p>
            ) : null}

            {cameraError ? (
              <p className="hud-text hud-text--error">{cameraError}</p>
            ) : null}

            {productUrl ? (
              <p className="hud-text">
                <a href={productUrl} target="_blank" rel="noreferrer" className="hud-link">
                  View Product ↗
                </a>
              </p>
            ) : null}
          </div>
        </div>
      </main>

      {/* ── Sidebar ─────────────────────────────────────────────────── */}
      <aside className="sidebar">
        <nav className="tabs">
          <button
            id="tab-closet"
            className={`tab-btn${activeTab === 'closet' ? ' active' : ''}`}
            onClick={() => setActiveTab('closet')}
          >
            My Closet
          </button>
          <button
            id="tab-ai"
            className={`tab-btn${activeTab === 'ai' ? ' active' : ''}`}
            onClick={() => setActiveTab('ai')}
          >
            AI Suggestions
          </button>
        </nav>

        <section className="panel-content">
          {activeTab === 'closet' ? (
            <>
              <h2>Select a garment to overlay</h2>
              <div className="item-grid">
                {CLOSET_ITEMS.map((item) => (
                  <button
                    key={item.id}
                    id={`closet-item-${item.id}`}
                    className={`item-card${selectedItem?.id === item.id ? ' selected' : ''}`}
                    onClick={() => setSelectedItem(item)}
                  >
                    <div className="item-image-placeholder">{item.emoji}</div>
                    <div className="item-info">
                      <h3>{item.name}</h3>
                      <p>{item.category}</p>
                    </div>
                    <div className="item-price">{item.price}</div>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <h2>Recommended Complements</h2>
              <div className="item-grid">
                {RECOMMENDATIONS.map((item) => (
                  <button
                    key={item.id}
                    id={`rec-item-${item.id}`}
                    className="item-card"
                    onClick={() => alert(`Redirecting to online merchant catalogue for ${item.name}`)}
                  >
                    <div className="item-image-placeholder">{item.emoji}</div>
                    <div className="item-info">
                      <h3>{item.name}</h3>
                      <p style={{ color: '#10b981', fontWeight: '600' }}>{item.category}</p>
                    </div>
                    <div className="item-price">{item.price}</div>
                  </button>
                ))}
              </div>
            </>
          )}
        </section>
        
        {/* Dynamic Voice Prompt Suggested HUD Box */}
        <section className="suggested-commands" style={{ padding: '0 24px 24px 24px', borderTop: '1px solid rgba(255, 255, 255, 0.05)' }}>
           <h4 style={{ color: '#818cf8', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '16px 0 8px 0', display: 'flex', alignItems: 'center', gap: '6px' }}>
             <span>💡</span> Voice Command Hints:
           </h4>
           <ul style={{ color: '#94a3b8', fontSize: '0.78rem', paddingLeft: '16px', margin: 0, lineHeight: '1.7', listStyleType: 'square' }}>
             <li>"Hi, I want to try on some clothes!"</li>
             <li>"Take my picture" (Triggers 3s countdown)</li>
             <li>"Try on the Cyberpunk Bomber"</li>
             <li>"Show me a pink summer dress"</li>
           </ul>
        </section>
      </aside>
    </div>
  )
}

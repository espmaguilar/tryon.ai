import { useCallback, useEffect, useRef, useState } from 'react';
import './App.css';

// Mock Data for Clothes Catalog
const CLOSET_ITEMS = [
  {
    id: 't1',
    name: 'Cyberpunk Bomber',
    category: 'Outerwear',
    price: '$89.00',
    emoji: '🧥',
    imageUrl: 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab',
    productUrl: '',
  },
  {
    id: 't2',
    name: 'Classic Denim Jacket',
    category: 'Outerwear',
    price: '$65.00',
    emoji: '🧥',
    imageUrl: 'https://images.unsplash.com/photo-1541099649105-f69ad21f3246',
    productUrl: '',
  },
  {
    id: 't3',
    name: 'Oversized Linen Shirt',
    category: 'Tops',
    price: '$45.00',
    emoji: '👕',
    imageUrl: 'https://images.unsplash.com/photo-1596755094514-f87e34085b2c',
    productUrl: '',
  },
  {
    id: 't4',
    name: 'Minimalist Black Tee',
    category: 'Tops',
    price: '$28.00',
    emoji: '👕',
    imageUrl: 'https://images.unsplash.com/photo-1527719327859-c6ce80353573',
    productUrl: '',
  },
];

const RECOMMENDATIONS = [
  { id: 'r1', name: 'Cargo Joggers', category: 'Match - 98%', price: '$55.00', emoji: '👖' },
  { id: 'r2', name: 'Techwear Boots', category: 'Match - 92%', price: '$120.00', emoji: '🥾' },
  { id: 'r3', name: 'Silver Chain Set', category: 'Match - 85%', price: '$19.00', emoji: '⛓️' },
];

const toCameraErrorMessage = (err) => {
  const code = err?.name || 'UnknownError';
  if (code === 'NotAllowedError' || code === 'SecurityError') {
    return 'Camera permission denied. Enable camera access in your browser/site settings.';
  }
  if (code === 'NotFoundError' || code === 'OverconstrainedError') {
    return 'No compatible camera device was found.';
  }
  if (code === 'NotReadableError') {
    return 'Camera is already in use by another app/tab.';
  }
  return `Could not start camera (${code}).`;
};

export default function App() {
  const [activeTab, setActiveTab] = useState('closet');
  const [selectedItem, setSelectedItem] = useState(null);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [processedImageUrl, setProcessedImageUrl] = useState('');
  const [productUrl, setProductUrl] = useState('');
  const [, setSyncStatus] = useState('DISCONNECTED');
  const [voiceTranscript, setVoiceTranscript] = useState('');
  const [cameraError, setCameraError] = useState('');
  const baseImagePath = (import.meta.env.VITE_BASE_IMAGE_PATH || '').trim();
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const streamListenerReadyRef = useRef(false);

  const sendAgentEvent = useCallback((type, payload) => {
    const streamCall = window.streamCall;
    if (streamCall && typeof streamCall.sendCustomEvent === 'function') {
      streamCall.sendCustomEvent({ type, payload });
      setSyncStatus('SYNCED');
      return;
    }

    // Fallback bridge for local testing without Stream SDK wiring in this app.
    window.dispatchEvent(
      new CustomEvent('agent_custom_event', {
        detail: { type, payload },
      }),
    );
    setSyncStatus('LOCAL_BRIDGE');
  }, []);

  const stopCamera = useCallback(() => {
    const currentStream = streamRef.current || videoRef.current?.srcObject;
    const tracks = currentStream?.getTracks?.() || [];
    tracks.forEach((track) => track.stop());

    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setIsCameraActive(false);
    sendAgentEvent('camera_state', { is_camera_active: false });
    sendAgentEvent('voice_control', { action: 'stop_transcription', source: 'mirror_power_down' });
  }, [sendAgentEvent]);

  const startCamera = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Live camera is not supported in this browser.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'user',
        },
        audio: false,
      });

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.muted = true;
        try {
          await videoRef.current.play();
        } catch {
          // Best effort only; browsers may still autoplay once user interacts.
        }
      }

      setIsCameraActive(true);
      setCameraError('');
      sendAgentEvent('camera_state', { is_camera_active: true });
      sendAgentEvent('voice_control', { action: 'start_transcription', source: 'mirror_initialize' });
    } catch (err) {
      console.error('Error accessing camera:', err);
      setCameraError(toCameraErrorMessage(err));
      stopCamera();
    }
  }, [sendAgentEvent, stopCamera]);

  const toggleCamera = useCallback(async () => {
    if (isCameraActive) {
      stopCamera();
      return;
    }

    await startCamera();
  }, [isCameraActive, startCamera, stopCamera]);

  useEffect(() => {
    if (isCameraActive && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.muted = true;
      videoRef.current.play().catch(() => {});
    }
  }, [isCameraActive]);

  const capturePoseDataUrl = useCallback(() => {
    const baseImageUrl = baseImagePath.trim();
    if (baseImageUrl) {
      return baseImageUrl;
    }

    const video = videoRef.current;
    if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
      return '';
    }

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) return '';

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  }, [baseImagePath]);

  const handleTakePhoto = useCallback(() => {
    const captured = capturePoseDataUrl();
    if (!captured) return '';

    sendAgentEvent('set_pose_image', { pose_image_url: captured });
    return captured;
  }, [capturePoseDataUrl, sendAgentEvent]);

  const handleCalibrate = useCallback(() => {
    if (!selectedItem) return;

    const poseImageUrl = capturePoseDataUrl();
    sendAgentEvent('set_merchandise', {
      item_id: selectedItem.id,
      image_url: selectedItem.imageUrl,
      product_url: selectedItem.productUrl,
      item_name: selectedItem.name,
      pose_image_url: poseImageUrl,
    });
  }, [capturePoseDataUrl, selectedItem, sendAgentEvent]);

  useEffect(() => {
    const handleIncomingEvent = (eventType, payload) => {
      if (eventType === 'mirror_update') {
        const imageUrl = payload?.image_url;
        const incomingProductUrl = payload?.product_url;
        if (typeof imageUrl === 'string' && imageUrl.trim()) {
          setProcessedImageUrl(imageUrl);
          setSyncStatus('SYNCED');
        }
        if (typeof incomingProductUrl === 'string' && incomingProductUrl.trim()) {
          setProductUrl(incomingProductUrl.trim());
        } else {
          setProductUrl('');
        }
      }

      if (eventType === 'voice_command') {
        const transcript = payload?.transcript || payload?.text || payload?.message;
        if (typeof transcript === 'string' && transcript.trim()) {
          const normalized = transcript.trim().toLowerCase();
          setVoiceTranscript(transcript.trim());
          setSyncStatus('SYNCED');

          if (normalized.includes('take photo') || normalized.includes('capture photo')) {
            handleTakePhoto();
          }

          if (normalized.includes('calibrate') || normalized.includes('try on') || normalized.includes('try-on')) {
            handleCalibrate();
          }
        }
      }
    };

    const streamCustomHandler = (event) => {
      const customData = event?.custom || {};
      const eventType = customData?.type || event?.type;
      const payload =
        customData?.payload ||
        customData?.custom ||
        event?.payload ||
        event?.custom?.payload ||
        {};
      handleIncomingEvent(eventType, payload);
    };

    const localBridgeHandler = (event) => {
      const detail = event?.detail || {};
      handleIncomingEvent(detail?.type, detail?.payload || {});
    };

    window.addEventListener('agent_custom_event', localBridgeHandler);

    const attachStreamListener = () => {
      const streamCall = window.streamCall;
      if (!streamCall || typeof streamCall.on !== 'function') {
        return null;
      }

      try {
        const maybeUnsubscribe = streamCall.on('custom', streamCustomHandler);
        if (typeof maybeUnsubscribe === 'function') {
          streamListenerReadyRef.current = true;
          return maybeUnsubscribe;
        }
      } catch {
        // Best-effort listener setup for local UI continuity.
      }

      return null;
    };

    let unsubscribeStream = attachStreamListener();
    let pollTimer = null;

    if (!unsubscribeStream) {
      pollTimer = window.setInterval(() => {
        if (streamListenerReadyRef.current) return;
        const maybeUnsubscribe = attachStreamListener();
        if (maybeUnsubscribe) {
          unsubscribeStream = maybeUnsubscribe;
          if (pollTimer) {
            window.clearInterval(pollTimer);
          }
        }
      }, 500);
    }

    return () => {
      window.removeEventListener('agent_custom_event', localBridgeHandler);
      if (pollTimer) {
        window.clearInterval(pollTimer);
      }
      if (typeof unsubscribeStream === 'function') {
        unsubscribeStream();
      }
    };
  }, [handleCalibrate, handleTakePhoto]);

  useEffect(() => () => {
    stopCamera();
  }, [stopCamera]);

  return (
    <div className="app-container">
      <main className="mirror-section">
        <header className="mirror-header">
          <h1>TRY ON AI</h1>
          <p>Interactive Smart Mirror System v1.0</p>
        </header>

        <div className="mirror-view-wrapper">
          {baseImagePath ? (
            <img src={baseImagePath} alt="Base pose" className="camera-feed" />
          ) : isCameraActive ? (
            <video ref={videoRef} autoPlay muted playsInline className="camera-feed" />
          ) : (
            <div className="camera-placeholder">
              <span style={{ fontSize: '3rem' }}>🪞</span>
              <p>Mirror display is offline</p>
            </div>
          )}

          {processedImageUrl ? (
            <img
              src={processedImageUrl}
              alt="Try-on result"
              className="camera-feed"
              onError={() => setProcessedImageUrl('')}
              style={{ position: 'absolute', inset: 0, objectFit: 'cover', opacity: 0.88, pointerEvents: 'none' }}
            />
          ) : null}

          <div className="mirror-overlay">
            <div className="overlay-badge">
              <div className="badge-pulse"></div>
              <span>{isCameraActive ? 'SYSTEM ACTIVE' : 'STANDBY'}</span>
            </div>

            {isCameraActive && <div className="scan-line"></div>}

            <div className="mirror-controls">
              <button className="btn" onClick={toggleCamera}>
                {isCameraActive ? 'Power Down Mirror' : 'Initialize Mirror'}
              </button>
              <button className="btn" onClick={handleTakePhoto} disabled={!isCameraActive && !baseImagePath}>
                Take Photo
              </button>
              <button
                className={`btn btn-primary ${!selectedItem ? 'disabled' : ''}`}
                onClick={handleCalibrate}
                disabled={!selectedItem}
              >
                Calibrate Fitment
              </button>
            </div>
            {voiceTranscript ? (
              <p style={{ marginTop: '8px', color: '#93c5fd', fontSize: '0.85rem' }}>
                Voice command: {voiceTranscript}
              </p>
            ) : null}
            {cameraError ? (
              <p style={{ marginTop: '8px', color: '#fca5a5', fontSize: '0.9rem' }}>
                {cameraError}
              </p>
            ) : null}
            {productUrl ? (
              <p style={{ marginTop: '8px', fontSize: '0.85rem' }}>
                <a href={productUrl} target="_blank" rel="noreferrer" style={{ color: '#93c5fd' }}>
                  View Product
                </a>
              </p>
            ) : null}
          </div>
        </div>
      </main>

      <aside className="sidebar">
        <nav className="tabs">
          <button
            className={`tab-btn ${activeTab === 'closet' ? 'active' : ''}`}
            onClick={() => setActiveTab('closet')}
          >
            My Closet
          </button>
          <button
            className={`tab-btn ${activeTab === 'ai' ? 'active' : ''}`}
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
                    className={`item-card ${selectedItem?.id === item.id ? 'selected' : ''}`}
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
      </aside>
    </div>
  );
}

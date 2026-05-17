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
  },
  {
    id: 't2',
    name: 'Classic Denim Jacket',
    category: 'Outerwear',
    price: '$65.00',
    emoji: '🧥',
    imageUrl: 'https://images.unsplash.com/photo-1541099649105-f69ad21f3246',
  },
  {
    id: 't3',
    name: 'Oversized Linen Shirt',
    category: 'Tops',
    price: '$45.00',
    emoji: '👕',
    imageUrl: 'https://images.unsplash.com/photo-1596755094514-f87e34085b2c',
  },
  {
    id: 't4',
    name: 'Minimalist Black Tee',
    category: 'Tops',
    price: '$28.00',
    emoji: '👕',
    imageUrl: 'https://images.unsplash.com/photo-1527719327859-c6ce80353573',
  },
];

const RECOMMENDATIONS = [
  { id: 'r1', name: 'Cargo Joggers', category: 'Match - 98%', price: '$55.00', emoji: '👖' },
  { id: 'r2', name: 'Techwear Boots', category: 'Match - 92%', price: '$120.00', emoji: '🥾' },
  { id: 'r3', name: 'Silver Chain Set', category: 'Match - 85%', price: '$19.00', emoji: '⛓️' },
];

const isLikelyImageUrl = (value) =>
  typeof value === 'string' &&
  /^https?:\/\//i.test(value) &&
  !/\.html?($|\?)/i.test(value);

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
  const [isMirrorActive, setIsMirrorActive] = useState(false);
  const [processedImageUrl, setProcessedImageUrl] = useState('');
  const [showResultOverlay, setShowResultOverlay] = useState(true);
  const [cameraError, setCameraError] = useState('');
  const [manualPoseImageUrl, setManualPoseImageUrl] = useState('');
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const fileInputRef = useRef(null);
  const publishedTrackTypeRef = useRef('');

  const sendAgentEvent = useCallback((type, payload) => {
    const streamCall = window.streamCall;
    if (streamCall && typeof streamCall.sendCustomEvent === 'function') {
      streamCall.sendCustomEvent({ type, payload });
    }
  }, []);

  const stopCamera = useCallback(() => {
    const streamCall = window.streamCall;
    const publishedTrackType = publishedTrackTypeRef.current;
    if (streamCall && typeof streamCall.stopPublish === 'function' && publishedTrackType) {
      streamCall.stopPublish(publishedTrackType).catch(() => {
        // Best-effort cleanup to avoid blocking camera shutdown.
      });
    }

    publishedTrackTypeRef.current = '';

    const currentStream = streamRef.current || videoRef.current?.srcObject;
    const tracks = currentStream?.getTracks?.() || [];
    tracks.forEach((track) => track.stop());

    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setIsMirrorActive(false);
  }, []);

  const startCamera = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Live camera is not supported here. Use Take Photo instead.');
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
        } catch (playErr) {
          console.error('Video playback failed:', playErr);
          setCameraError('Camera stream started, but playback was blocked by the browser.');
        }
      }

      const streamCall = window.streamCall;
      if (streamCall && typeof streamCall.publish === 'function') {
        try {
          await streamCall.publish(stream, 'video')
          publishedTrackTypeRef.current = 'video'
        } catch (publishErr) {
          console.error('GetStream publish failed:', publishErr);
          setCameraError('Camera is active, but publishing to Stream failed.');
        }
      }

      setShowResultOverlay(false);
      setCameraError('');
      setIsMirrorActive(true);
    } catch (err) {
      console.error('Error accessing camera:', err);
      setCameraError(toCameraErrorMessage(err));
      stopCamera();
    }
  }, [stopCamera]);

  const toggleCamera = useCallback(async () => {
    if (isMirrorActive) {
      stopCamera();
      return;
    }
    await startCamera();
  }, [isMirrorActive, startCamera, stopCamera]);

  useEffect(() => {
    sendAgentEvent('camera_state', { is_camera_active: isMirrorActive });
  }, [isMirrorActive, sendAgentEvent]);

  useEffect(() => {
    const mirrorUpdateHandler = (event) => {
      const detail = event?.detail || {};
      const payload = detail?.payload || detail || {};
      const imageUrl = payload?.image_url;
      if (typeof imageUrl === 'string' && imageUrl.trim()) {
        setProcessedImageUrl(imageUrl);
        setShowResultOverlay(true);
      }
    };

    const streamCustomHandler = (event) => {
      const eventType = event?.type || event?.custom?.type;
      const payload = event?.payload || event?.custom?.payload || {};
      if (eventType === 'mirror_update') {
        mirrorUpdateHandler({ detail: payload });
      }
    };

    window.addEventListener('mirror_update', mirrorUpdateHandler);

    const streamCall = window.streamCall;
    let unsubscribeStream = null;
    if (streamCall && typeof streamCall.on === 'function') {
      try {
        const maybeUnsubscribe = streamCall.on('custom', streamCustomHandler);
        if (typeof maybeUnsubscribe === 'function') {
          unsubscribeStream = maybeUnsubscribe;
        }
      } catch {
        // Best-effort listener setup; UI remains functional without subscription.
      }
    }

    return () => {
      window.removeEventListener('mirror_update', mirrorUpdateHandler);
      if (typeof unsubscribeStream === 'function') {
        unsubscribeStream();
      }
    };
  }, []);

  useEffect(() => {
    if (!isMirrorActive || !videoRef.current || !streamRef.current) return;
    if (videoRef.current.srcObject === streamRef.current) return;

    videoRef.current.srcObject = streamRef.current;
    videoRef.current.muted = true;
    videoRef.current.play().catch(() => {
      // Playback errors are handled during start; keep this sync best-effort.
    });
  }, [isMirrorActive]);

  useEffect(() => {
    const previousBodyOverflowX = document.body.style.overflowX;
    const previousBodyMargin = document.body.style.margin;
    const previousHtmlOverflowX = document.documentElement.style.overflowX;

    document.body.style.overflowX = 'hidden';
    document.body.style.margin = '0';
    document.documentElement.style.overflowX = 'hidden';

    return () => {
      stopCamera();
      document.body.style.overflowX = previousBodyOverflowX;
      document.body.style.margin = previousBodyMargin;
      document.documentElement.style.overflowX = previousHtmlOverflowX;
    };
  }, [stopCamera]);

  const capturePoseDataUrl = useCallback(() => {
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
  }, []);

  const openPhotoPicker = useCallback(() => {
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  }, []);

  const handlePhotoFileChange = useCallback((event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : '';
      if (dataUrl.startsWith('data:image/')) {
        setManualPoseImageUrl(dataUrl);
        setCameraError('');
      } else {
        setCameraError('Selected file is not a valid image.');
      }
    };
    reader.onerror = () => {
      setCameraError('Could not read selected photo.');
    };
    reader.readAsDataURL(file);
  }, []);

  const handleTakePhoto = useCallback(() => {
    if (isMirrorActive) {
      const captured = capturePoseDataUrl();
      if (!captured) {
        setCameraError('Could not capture photo from live camera.');
        return;
      }
      setManualPoseImageUrl(captured);
      return;
    }

    openPhotoPicker();
  }, [capturePoseDataUrl, isMirrorActive, openPhotoPicker]);

  const handleCalibrate = useCallback(() => {
    if (!selectedItem) return;
    if (!isLikelyImageUrl(selectedItem.imageUrl)) {
      alert('Selected item does not have a valid direct image URL.');
      return;
    }

    const livePoseImageUrl = capturePoseDataUrl();
    const poseImageUrl = livePoseImageUrl || manualPoseImageUrl;

    sendAgentEvent('set_merchandise', {
      item_id: selectedItem.id,
      image_url: selectedItem.imageUrl,
      item_name: selectedItem.name,
      pose_image_url: poseImageUrl,
    });
  }, [capturePoseDataUrl, manualPoseImageUrl, selectedItem, sendAgentEvent]);

  const previewPoseUrl = manualPoseImageUrl || processedImageUrl;

  return (
    <div className="app-container">
      <main className="mirror-section">
        <header className="mirror-header">
          <h1>TRY ON AI</h1>
          <p>Interactive Smart Mirror System v1.0</p>
        </header>

        <div className="mirror-view-wrapper">
          {isMirrorActive ? (
            <video ref={videoRef} autoPlay muted playsInline className="camera-feed" />
          ) : previewPoseUrl ? (
            <img
              src={previewPoseUrl}
              alt="Captured pose preview"
              className="camera-feed"
              onError={() => setManualPoseImageUrl('')}
              style={{ pointerEvents: 'none' }}
            />
          ) : (
            <div className="camera-placeholder">
              <span style={{ fontSize: '3rem' }}>🪞</span>
              <p>Mirror display is offline</p>
            </div>
          )}

          {processedImageUrl && showResultOverlay ? (
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
              <span>{isMirrorActive ? 'SYSTEM ACTIVE' : 'STANDBY'}</span>
            </div>

            {isMirrorActive && <div className="scan-line"></div>}

            <div className="mirror-controls">
              <button className="btn" onClick={toggleCamera}>
                {isMirrorActive ? 'Power Down Mirror' : 'Initialize Mirror'}
              </button>
              <button className="btn" onClick={handleTakePhoto}>
                {isMirrorActive ? 'Take Photo' : 'Upload / Take Photo'}
              </button>
              <button
                className={`btn btn-primary ${!selectedItem ? 'disabled' : ''}`}
                onClick={handleCalibrate}
                disabled={!selectedItem}
              >
                Calibrate Fitment
              </button>
              {processedImageUrl ? (
                <button className="btn" onClick={() => setShowResultOverlay((prev) => !prev)}>
                  {showResultOverlay ? 'Show Live Camera' : 'Show Try-On Result'}
                </button>
              ) : null}
            </div>
            {cameraError ? (
              <p style={{ marginTop: '8px', color: '#fca5a5', fontSize: '0.9rem' }}>{cameraError}</p>
            ) : null}
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="user"
          style={{ display: 'none' }}
          onChange={handlePhotoFileChange}
        />
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

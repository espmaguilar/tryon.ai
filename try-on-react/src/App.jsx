import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  {
    id: 'r1',
    name: 'Cargo Joggers',
    category: 'Bottoms',
    match: 98,
    price: '$55.00',
    emoji: '👖',
    merchantUrl: 'https://www.google.com/search?q=cargo+joggers',
  },
  {
    id: 'r2',
    name: 'Techwear Boots',
    category: 'Footwear',
    match: 92,
    price: '$120.00',
    emoji: '🥾',
    merchantUrl: 'https://www.google.com/search?q=techwear+boots',
  },
  {
    id: 'r3',
    name: 'Silver Chain Set',
    category: 'Accessories',
    match: 85,
    price: '$19.00',
    emoji: '⛓️',
    merchantUrl: 'https://www.google.com/search?q=silver+chain+set',
  },
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
  const [selectedItem, setSelectedItem] = useState(null);
  const [isMirrorActive, setIsMirrorActive] = useState(false);
  const [processedImageUrl, setProcessedImageUrl] = useState('');
  const [showResultOverlay, setShowResultOverlay] = useState(true);
  const [cameraError, setCameraError] = useState('');
  const [manualPoseImageUrl, setManualPoseImageUrl] = useState('');
  const [isGeneratingTryOn, setIsGeneratingTryOn] = useState(false);
  const [generationStatus, setGenerationStatus] = useState('Standby');
  const [backendHealth, setBackendHealth] = useState('offline');
  const [streamConnectionState, setStreamConnectionState] = useState('idle');
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [diagnostics, setDiagnostics] = useState({
    lastEvent: 'none',
    requestId: 'n/a',
    message: 'No events yet.',
    updatedAt: 'n/a',
  });
  const [voiceToast, setVoiceToast] = useState({
    visible: false,
    message: '',
  });

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const fileInputRef = useRef(null);
  const publishedTrackTypeRef = useRef('');

  const styleFinderResults = useMemo(() => {
    if (!selectedItem) return RECOMMENDATIONS;

    return RECOMMENDATIONS.map((item) => ({
      ...item,
      contextLabel: `Works with ${selectedItem.category.toLowerCase()}`,
    }));
  }, [selectedItem]);

  const findClosetItem = useCallback((payload) => {
    const itemId = typeof payload?.item_id === 'string' ? payload.item_id : '';
    const itemName = typeof payload?.item_name === 'string' ? payload.item_name : '';
    const itemImage = typeof payload?.image_url === 'string' ? payload.image_url : '';

    const byId = itemId ? CLOSET_ITEMS.find((item) => item.id === itemId) : null;
    if (byId) return byId;

    const byName = itemName
      ? CLOSET_ITEMS.find((item) => item.name.toLowerCase() === itemName.toLowerCase())
      : null;
    if (byName) return byName;

    const byImage = itemImage
      ? CLOSET_ITEMS.find((item) => item.imageUrl === itemImage)
      : null;
    return byImage || null;
  }, []);

  const sendAgentEvent = useCallback((type, payload) => {
    const streamCall = window.streamCall;
    if (streamCall && typeof streamCall.sendCustomEvent === 'function') {
      streamCall.sendCustomEvent({ type, payload });
      return true;
    }
    return false;
  }, []);

  const emitLocalMirrorUpdate = useCallback((poseImageUrl, garmentName) => {
    window.dispatchEvent(
      new CustomEvent('mirror_update', {
        detail: {
          image_url: poseImageUrl,
          local_preview: true,
          garment_name: garmentName,
        },
      }),
    );
  }, []);

  const recordDiagnostics = useCallback((next) => {
    const updatedAt = new Date().toLocaleTimeString();
    setDiagnostics((prev) => ({
      ...prev,
      ...next,
      updatedAt,
    }));
  }, []);

  const showVoiceToast = useCallback((message) => {
    if (!message) return;
    setVoiceToast({ visible: true, message });
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
      setCameraError('Live camera is not supported here. Use Upload / Take Photo instead.');
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
          await streamCall.publish(stream, 'video');
          publishedTrackTypeRef.current = 'video';
        } catch (publishErr) {
          console.error('GetStream publish failed:', publishErr);
          setCameraError('Camera is active, but publishing to Stream failed.');
        }
      }

      setShowResultOverlay(false);
      setGenerationStatus('Mirror live');
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
    const syncBackendHealth = () => {
      const hasStream = Boolean(window.streamCall);
      setBackendHealth((prev) => {
        if (hasStream && (prev === 'offline' || prev === 'error')) return 'online';
        if (!hasStream && prev === 'online') return 'offline';
        return prev;
      });
    };

    const streamStatusHandler = (event) => {
      const detail = event?.detail || {};
      const status = detail?.status || 'unknown';

      setStreamConnectionState(status);
      if (status === 'online') {
        setBackendHealth('online');
        setCameraError('');
        recordDiagnostics({
          lastEvent: 'stream_status(online)',
          message: 'GetStream call connected.',
        });
      } else if (status === 'connecting') {
        setBackendHealth('degraded');
        recordDiagnostics({
          lastEvent: 'stream_status(connecting)',
          message: 'Connecting to GetStream...',
        });
      } else if (status === 'offline') {
        setBackendHealth('offline');
        recordDiagnostics({
          lastEvent: 'stream_status(offline)',
          message: detail?.reason || 'GetStream is not configured.',
        });
      } else if (status === 'error') {
        setBackendHealth('error');
        setCameraError(detail?.message || 'GetStream connection failed.');
        recordDiagnostics({
          lastEvent: 'stream_status(error)',
          message: detail?.message || 'GetStream connection failed.',
        });
      }
    };

    syncBackendHealth();
    window.addEventListener('stream_status', streamStatusHandler);
    const intervalId = window.setInterval(syncBackendHealth, 1500);

    return () => {
      window.removeEventListener('stream_status', streamStatusHandler);
      window.clearInterval(intervalId);
    };
  }, [recordDiagnostics]);

  useEffect(() => {
    const mirrorUpdateHandler = (event) => {
      const detail = event?.detail || {};
      const payload = detail?.payload || detail || {};
      const imageUrl = payload?.image_url;
      const errorMessage = payload?.error_message;

      if (typeof imageUrl === 'string' && imageUrl.trim()) {
        setProcessedImageUrl(imageUrl);
        setShowResultOverlay(true);
        setIsGeneratingTryOn(false);
        if (payload?.local_preview) {
          setBackendHealth('degraded');
          setGenerationStatus('Local preview ready (backend offline)');
          recordDiagnostics({
            lastEvent: 'mirror_update(local_preview)',
            message: 'Using offline local preview fallback.',
          });
        } else {
          setBackendHealth('online');
          setGenerationStatus('NanoBanana try-on ready');
          recordDiagnostics({
            lastEvent: 'mirror_update(success)',
            requestId: payload?.job_id || 'n/a',
            message: payload?.message || 'Try-on image received from backend.',
          });
        }
      }

      if (typeof errorMessage === 'string' && errorMessage.trim()) {
        setIsGeneratingTryOn(false);
        setBackendHealth('error');
        setCameraError(errorMessage);
        setGenerationStatus('Try-on failed');
        recordDiagnostics({
          lastEvent: 'mirror_update(error)',
          requestId: payload?.job_id || 'n/a',
          message: errorMessage,
        });
      }
    };

    const streamCustomHandler = (event) => {
      const eventType = event?.type || event?.custom?.type;
      const payload = event?.payload || event?.custom?.payload || {};
      if (eventType === 'mirror_update') {
        mirrorUpdateHandler({ detail: payload });
      }

      if (eventType === 'photo_captured') {
        const capturedDataUrl = payload?.image_data_url;
        if (typeof capturedDataUrl === 'string' && capturedDataUrl.startsWith('data:image/')) {
          setManualPoseImageUrl(capturedDataUrl);
          setGenerationStatus('Voice capture ready');
          setCameraError('');
          showVoiceToast('📸 Voice photo captured');
          recordDiagnostics({
            lastEvent: 'photo_captured',
            message: 'Voice agent captured a new photo.',
          });
        }
      }

      if (eventType === 'voice_garment_selected') {
        const matchedItem = findClosetItem(payload);
        if (matchedItem) {
          setSelectedItem(matchedItem);
          setGenerationStatus(`Voice selected: ${matchedItem.name}`);
          showVoiceToast(`🧥 Voice selected ${matchedItem.name}`);
          recordDiagnostics({
            lastEvent: 'voice_garment_selected',
            message: `Voice selected garment: ${matchedItem.name}`,
          });
        }
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
  }, [findClosetItem, recordDiagnostics, showVoiceToast]);

  useEffect(() => {
    if (!isGeneratingTryOn) return;

    const timeoutId = window.setTimeout(() => {
      setIsGeneratingTryOn(false);
      setGenerationStatus('Still waiting for mirror response');
      setCameraError('Try-on is taking longer than expected. Confirm the Stream backend is running.');
    }, 25000);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [isGeneratingTryOn]);

  useEffect(() => {
    if (!voiceToast.visible) return;
    const timeoutId = window.setTimeout(() => {
      setVoiceToast((prev) => ({ ...prev, visible: false }));
    }, 2200);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [voiceToast.visible]);

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
        setGenerationStatus('Customer photo ready');
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
      setGenerationStatus('Snapshot captured');
      return;
    }

    openPhotoPicker();
  }, [capturePoseDataUrl, isMirrorActive, openPhotoPicker]);

  const handleCalibrate = useCallback(() => {
    if (!selectedItem) return;
    if (!isLikelyImageUrl(selectedItem.imageUrl)) {
      setCameraError('Selected garment does not have a valid direct image URL.');
      return;
    }

    const livePoseImageUrl = capturePoseDataUrl();
    const poseImageUrl = livePoseImageUrl || manualPoseImageUrl;
    if (!poseImageUrl) {
      setCameraError('Take or upload a customer photo first.');
      return;
    }

    setCameraError('');
    setIsGeneratingTryOn(true);
    setGenerationStatus('Sending NanoBanana request...');
    setShowResultOverlay(true);

    const requestId = `tryon-${Date.now()}-${selectedItem.id}`;
    recordDiagnostics({
      lastEvent: 'generate_tryon(request)',
      requestId,
      message: `Sent request for ${selectedItem.name}.`,
    });
    const payload = {
      request_id: requestId,
      provider: 'nanobanana',
      item_id: selectedItem.id,
      item_name: selectedItem.name,
      image_url: selectedItem.imageUrl,
      pose_image_url: poseImageUrl,
      options: {
        mode: 'virtual_mirror_tryon',
        source: livePoseImageUrl ? 'camera_capture' : 'uploaded_photo',
      },
    };

    const sentTryOnEvent = sendAgentEvent('generate_tryon', payload);

    if (sentTryOnEvent) {
      setBackendHealth('online');
    }

    if (!sentTryOnEvent) {
      emitLocalMirrorUpdate(poseImageUrl, selectedItem.name);
      setBackendHealth('offline');
      setIsGeneratingTryOn(false);
      setGenerationStatus('Local try-on preview ready (offline mode)');
      setCameraError('');
      recordDiagnostics({
        lastEvent: 'generate_tryon(local_fallback)',
        message: 'Stream backend not reachable; using local preview.',
      });
    }
  }, [capturePoseDataUrl, emitLocalMirrorUpdate, manualPoseImageUrl, recordDiagnostics, selectedItem, sendAgentEvent]);

  const handleStyleFinderPick = useCallback(
    (item) => {
      sendAgentEvent('style_finder_pick', {
        recommendation_id: item.id,
        recommendation_name: item.name,
        selected_garment_id: selectedItem?.id || null,
      });
      window.open(item.merchantUrl, '_blank', 'noopener,noreferrer');
    },
    [selectedItem, sendAgentEvent]
  );

  const handleReconnectStream = useCallback(async () => {
    const reconnectFn = window.reconnectStream;
    if (typeof reconnectFn !== 'function') {
      setCameraError('Reconnect function not available. Refresh the page.');
      return;
    }

    try {
      setStreamConnectionState('connecting');
      setBackendHealth('degraded');
      await reconnectFn();
    } catch {
      setBackendHealth('error');
      setCameraError('Reconnect failed. Check Stream credentials and backend agent.');
    }
  }, []);

  const previewPoseUrl = processedImageUrl;
  const backendHealthLabel =
    backendHealth === 'online'
      ? 'Backend Connected'
      : backendHealth === 'degraded'
        ? 'Offline Preview Mode'
        : backendHealth === 'error'
          ? 'Backend Error'
          : 'Backend Offline';

  return (
    <div className="app-container">
      <main className="mirror-section">
        <header className="mirror-header">
          <h1>TRY ON AI</h1>
          <p>Interactive Smart Mirror System v1.0</p>
        </header>

        <div className="mirror-view-wrapper">
          <div className="mirror-stage">
            {isMirrorActive ? (
              <video ref={videoRef} autoPlay muted playsInline className="camera-feed mirrored" />
            ) : previewPoseUrl ? (
              <img
                src={previewPoseUrl}
                alt="Try-on preview"
                className="camera-feed mirrored"
                onError={() => setProcessedImageUrl('')}
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
                className="camera-feed generated"
                onError={() => setProcessedImageUrl('')}
                style={{ opacity: 0.92, pointerEvents: 'none' }}
              />
            ) : null}
          </div>

          <div className="mirror-overlay">
            <div className="overlay-badge">
              <div className="badge-pulse"></div>
              <span>{isMirrorActive ? 'SYSTEM ACTIVE' : 'STANDBY'}</span>
            </div>
            <button
              className={`backend-health-badge ${backendHealth}`}
              type="button"
              onClick={() => setShowDiagnostics((prev) => !prev)}
              title="Toggle backend diagnostics"
            >
              <span>{backendHealthLabel}</span>
            </button>
            {showDiagnostics ? (
              <div className="backend-diagnostics-popover">
                <p><strong>Last Event:</strong> {diagnostics.lastEvent}</p>
                <p><strong>Request ID:</strong> {diagnostics.requestId}</p>
                <p><strong>Message:</strong> {diagnostics.message}</p>
                <p><strong>Stream State:</strong> {streamConnectionState}</p>
                <p><strong>Updated:</strong> {diagnostics.updatedAt}</p>
                <button className="diagnostics-reconnect-btn" type="button" onClick={handleReconnectStream}>
                  Reconnect Stream
                </button>
              </div>
            ) : null}
            {voiceToast.visible ? (
              <div className="voice-toast" role="status" aria-live="polite">
                {voiceToast.message}
              </div>
            ) : null}

            {isMirrorActive && <div className="scan-line"></div>}

            <div className="mirror-bottom-dock">
              <div className="mirror-controls">
                <button className="btn" onClick={toggleCamera}>
                  {isMirrorActive ? 'Power Down Mirror' : 'Initialize Mirror'}
                </button>
                <button className="btn" onClick={handleTakePhoto}>
                  {isMirrorActive ? 'Take Photo' : 'Upload / Take Photo'}
                </button>
                <button
                  className={`btn btn-primary ${!selectedItem || isGeneratingTryOn ? 'disabled' : ''}`}
                  onClick={handleCalibrate}
                  disabled={!selectedItem || isGeneratingTryOn}
                >
                  {isGeneratingTryOn ? 'Generating Try-On...' : 'Generate NanoBanana Try-On'}
                </button>
                {processedImageUrl ? (
                  <button className="btn" onClick={() => setShowResultOverlay((prev) => !prev)}>
                    {showResultOverlay ? 'Show Live Camera' : 'Show Try-On Result'}
                  </button>
                ) : null}
              </div>

              <p className="generation-status">{generationStatus}</p>
              {cameraError ? <p className="camera-error">{cameraError}</p> : null}
            </div>
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
        <section className="panel-content">
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

          <section className="style-finder-section">
            <div className="style-finder-header">
              <h2>Style Finder</h2>
              <p>
                {selectedItem
                  ? `Recommended complements for ${selectedItem.name}`
                  : 'Pick a garment to get contextual style recommendations'}
              </p>
            </div>
            <div className="item-grid">
              {styleFinderResults.map((item) => (
                <button key={item.id} className="item-card style-finder-card" onClick={() => handleStyleFinderPick(item)}>
                  <div className="item-image-placeholder">{item.emoji}</div>
                  <div className="item-info">
                    <h3>{item.name}</h3>
                    <p style={{ color: '#10b981', fontWeight: '600' }}>Match - {item.match}%</p>
                    {item.contextLabel ? <p className="style-context">{item.contextLabel}</p> : null}
                  </div>
                  <div className="item-price">{item.price}</div>
                </button>
              ))}
            </div>
          </section>
        </section>
      </aside>
    </div>
  );
}

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

export default function App() {
  const [activeTab, setActiveTab] = useState('closet');
  const [selectedItem, setSelectedItem] = useState(null);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [processedImageUrl, setProcessedImageUrl] = useState('');
  const [syncStatus, setSyncStatus] = useState('DISCONNECTED');
  const videoRef = useRef(null);
  const streamRef = useRef(null);

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
      })
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

    setIsMirrorActive(false);
  }, []);

  const startCamera = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      alert('Camera access is not supported in this browser.');
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
      }

      setIsMirrorActive(true);
    } catch (err) {
      console.error('Error accessing camera:', err);
      alert('Could not access camera. Please check your permissions.');
      stopCamera();
    }
  }, [stopCamera]);

  const handleMirrorToggle = useCallback(async () => {
    if (isMirrorActive) {
      stopCamera();
      return;
    }

    await startCamera();
  }, [isCameraActive, startCamera, stopCamera]);

  useEffect(() => {
    if (isMirrorActive && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
    }
  }, [isMirrorActive]);

  useEffect(() => () => {
    stopCamera();
  }, [stopCamera]);

  const handleCalibrate = useCallback(() => {
    if (!selectedItem) return;
    sendAgentEvent('set_merchandise', {
      item_id: selectedItem.id,
      image_url: selectedItem.imageUrl,
      item_name: selectedItem.name,
    });
  }, [selectedItem, sendAgentEvent]);

  return (
    <div
      className="app-container"
      style={{ width: '100%', minHeight: '100vh', overflowX: 'hidden', overflowY: 'auto' }}
    >
      {/* Left Pane: The Smart Mirror Interface */}
      <main className="mirror-section">
        <header className="mirror-header">
          <h1>TRY ON AI</h1>
          <p>Interactive Smart Mirror System v1.0</p>
        </header>

        <div className="mirror-view-wrapper">
          {isCameraActive ? (
            <video 
              ref={videoRef} 
              autoPlay 
              playsInline 
              className="camera-feed"
              style={{ width: '100%', height: '100%', flex: '1 1 auto', objectFit: 'cover' }}
            />
          ) : (
            <div className="camera-placeholder" style={{ width: '100%', height: '100%', flex: '1 1 auto' }}>
              <span style={{ fontSize: '3rem' }}>🪞</span>
              <p>Mirror display is offline</p>
            </div>
          )}

          {processedImageUrl ? (
            <img
              src={processedImageUrl}
              alt="Try-on result"
              className="camera-feed"
              style={{ position: 'absolute', inset: 0, objectFit: 'cover', opacity: 0.88 }}
            />
          ) : null}

          {/* Smart Mirror HUD Overlay */}
          <div className="mirror-overlay">
            <div className="overlay-badge">
              <div className="badge-pulse"></div>
              <span>{isCameraActive ? 'SYSTEM ACTIVE' : 'STANDBY'}</span>
            </div>

            {isMirrorActive && <div className="scan-line"></div>}

            <div className="mirror-controls">
              <button className="btn" onClick={toggleCamera}>
                {isCameraActive ? 'Power Down Mirror' : 'Initialize Mirror'}
              </button>
              <button 
                className={`btn btn-primary ${!selectedItem ? 'disabled' : ''}`}
                onClick={() => alert(`Analyzing fitment data for: ${selectedItem?.name}`)}
                disabled={!selectedItem}
              >
                Calibrate Fitment
              </button>
            </div>
          </div>
        </div>
      </main>

      {/* Right Pane: Catalog and Recommendation Engine */}
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
              <div className="item-grid-container">
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
              </div>
            </>
          ) : (
            <>
              <h2>Recommended Complements</h2>
              <div className="item-grid-container">
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
              </div>
            </>
          )}
        </section>
      </aside>
    </div>
  );
}

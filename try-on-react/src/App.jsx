import React, { useState, useEffect } from 'react';
import './App.css';

const CLOSET_ITEMS = [
  { id: 't1', name: 'Cyberpunk Bomber', category: 'Outerwear', price: '$89.00', emoji: '🧥' },
  { id: 't2', name: 'Classic Denim Jacket', category: 'Outerwear', price: '$65.00', emoji: '🧥' },
  { id: 't3', name: 'Oversized Linen Shirt', category: 'Tops', price: '$45.00', emoji: '👕' },
  { id: 't4', name: 'Minimalist Black Tee', category: 'Tops', price: '$28.00', emoji: '👕' },
];

const RECOMMENDATIONS = [
  { id: 'r1', name: 'Cargo Joggers', category: 'Match - 98%', price: '$55.00', emoji: '👖' },
  { id: 'r2', name: 'Techwear Boots', category: 'Match - 92%', price: '$120.00', emoji: '🥾' },
  { id: 'r3', name: 'Silver Chain Set', category: 'Match - 85%', price: '$19.00', emoji: '⛓️' },
];

export default function App() {
  const [activeTab, setActiveTab] = useState('closet');
  const [selectedItem, setSelectedItem] = useState(null);
  const [isMirrorOnline, setIsMirrorOnline] = useState(false);
  const [isCalibrating, setIsCalibrating] = useState(false);

  // Simulates an AI scanning framework initializing
  const handleMirrorToggle = () => {
    if (isMirrorOnline) {
      setIsMirrorOnline(false);
      setIsCalibrating(false);
    } else {
      setIsCalibrating(true);
    }
  };

  // Simulates a 2-second calibration lag typical of vision processing
  useEffect(() => {
    let timer;
    if (isCalibrating) {
      timer = setTimeout(() => {
        setIsCalibrating(false);
        setIsMirrorOnline(true);
      }, 2000);
    }
    return () => clearTimeout(timer);
  }, [isCalibrating]);

  return (
    <div className="app-container">
      {/* Left Pane: The Smart Mirror Viewport */}
      <main className="mirror-section">
        <header className="mirror-header">
          <h1>TRY ON AI</h1>
          <p>Interactive Smart Mirror System v1.0</p>
        </header>

        <div className="mirror-view-wrapper">
          {isCalibrating ? (
            <div className="camera-placeholder">
              <div className="badge-pulse" style={{ width: '24px', height: '24px', marginBottom: '16px' }}></div>
              <p style={{ color: '#38bdf8', letterSpacing: '0.1em' }}>INITIALIZING AI ENGINE...</p>
            </div>
          ) : isMirrorOnline ? (
            /* GetStream integration will replace this block later */
            <div className="camera-placeholder" style={{ background: 'linear-gradient(to bottom, #1e1b4b, #030712)' }}>
              <span style={{ fontSize: '4rem', marginBottom: '8px' }}>👤</span>
              <p style={{ color: '#a5b4fc' }}>Live Video Stream Matrix</p>
              <p style={{ color: '#64748b', fontSize: '0.8rem' }}>[ GetStream Video Pipeline Component Holder ]</p>
              {selectedItem && (
                <div style={{ fontSize: '5rem', marginTop: '20px', animation: 'pulse 2s infinite' }}>
                  {selectedItem.emoji}
                </div>
              )}
            </div>
          ) : (
            <div className="camera-placeholder">
              <span style={{ fontSize: '3rem' }}>🪞</span>
              <p>Mirror display is offline</p>
            </div>
          )}

          {/* Smart Mirror HUD Overlay */}
          <div className="mirror-overlay">
            <div className="overlay-badge">
              <div className="badge-pulse" style={{ backgroundColor: isMirrorOnline ? '#10b981' : isCalibrating ? '#f59e0b' : '#ef4444' }}></div>
              <span>{isMirrorOnline ? 'SYSTEM ACTIVE' : isCalibrating ? 'CALIBRATING' : 'STANDBY'}</span>
            </div>

            {isMirrorOnline && <div className="scan-line"></div>}

            <div className="mirror-controls">
              <button className="btn" onClick={handleMirrorToggle} disabled={isCalibrating}>
                {isMirrorOnline ? 'Power Down Mirror' : 'Initialize Mirror'}
              </button>
              <button 
                className="btn btn-primary"
                onClick={() => alert(`Calibrating target framework coordinates for: ${selectedItem?.name}`)}
                disabled={!selectedItem || !isMirrorOnline}
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
                    onClick={() => alert(`Redirecting to catalogue for ${item.name}`)}
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
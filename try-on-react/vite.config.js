import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Load from repo root (two levels up from try-on-react) AND from try-on-react dir
  const envFromRoot = loadEnv(mode, '..', '')
  const envLocal = loadEnv(mode, '.', '')
  const env = { ...envFromRoot, ...envLocal }

  return {
    plugins: [react()],
    define: {
      'import.meta.env.VITE_STREAM_API_KEY': JSON.stringify(
        env.VITE_STREAM_API_KEY || env.STREAM_API_KEY || '',
      ),
      'import.meta.env.VITE_STREAM_USER_ID': JSON.stringify(
        env.VITE_STREAM_USER_ID || env.STREAM_USER_ID || '',
      ),
      'import.meta.env.VITE_STREAM_USER_NAME': JSON.stringify(
        env.VITE_STREAM_USER_NAME || env.STREAM_USER_NAME || '',
      ),
      'import.meta.env.VITE_STREAM_USER_TOKEN': JSON.stringify(
        env.VITE_STREAM_USER_TOKEN || env.STREAM_USER_TOKEN || '',
      ),
      'import.meta.env.VITE_STREAM_CALL_TYPE': JSON.stringify(
        env.VITE_STREAM_CALL_TYPE || env.STREAM_CALL_TYPE || 'default',
      ),
      'import.meta.env.VITE_STREAM_CALL_ID': JSON.stringify(
        env.VITE_STREAM_CALL_ID || env.STREAM_CALL_ID || 'tryon-mirror',
      ),
      'import.meta.env.VITE_BASE_IMAGE_PATH': JSON.stringify(
        env.VITE_BASE_IMAGE_PATH || env.BASE_IMAGE_PATH || '',
      ),
      // Flask backend URL — defaults to localhost:5001 for local dev
      'import.meta.env.VITE_BACKEND_URL': JSON.stringify(
        env.VITE_BACKEND_URL || env.BACKEND_URL || 'http://localhost:5001',
      ),
    },
    server: {
      // Proxy /api calls to the Flask backend during dev to avoid CORS preflight
      proxy: {
        '/api': {
          target: env.VITE_BACKEND_URL || env.BACKEND_URL || 'http://localhost:5001',
          changeOrigin: true,
        },
      },
    },
  }
})

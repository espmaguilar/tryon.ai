import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '')

  return {
    plugins: [react()],
    define: {
      'import.meta.env.VITE_STREAM_API_KEY': JSON.stringify(
        env.STREAM_API_KEY || '',
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
        env.VITE_STREAM_CALL_TYPE || env.STREAM_CALL_TYPE || '',
      ),
      'import.meta.env.VITE_STREAM_CALL_ID': JSON.stringify(
        env.VITE_STREAM_CALL_ID || env.STREAM_CALL_ID || '',
      ),
    },
  }
})

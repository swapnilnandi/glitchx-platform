// API address comes from the environment so the same build works locally and in production.
//   local dev  : nothing to set (falls back to http://127.0.0.1:8000)
//   production : create frontend/.env.production with VITE_API_URL=https://api.your-domain.com
export const API_URL = (import.meta.env.VITE_API_URL || "http://127.0.0.1:8000").replace(/\/+$/, "");
export const WS_URL = (import.meta.env.VITE_WS_URL || API_URL.replace(/^http/, "ws")).replace(/\/+$/, "");
import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './styles.css'
import Home from './screens/Home.jsx'
import Lobby from './screens/Lobby.jsx'
import Table from './screens/Table.jsx'
import Ranking from './screens/Ranking.jsx'
import Toaster from './components/Toaster.jsx'
import { useDemoRoom } from './hooks/useDemoRoom.jsx'
import { registerSW } from 'virtual:pwa-register'

// PWA: en mobile (sobre todo iOS instalada) casi nunca se busca versión nueva.
// Chequear al abrir, al volver a la app y cada hora; con autoUpdate recarga sola.
registerSW({
  immediate: true,
  onRegisteredSW(_url, reg) {
    if (!reg) return
    const check = () => reg.update().catch(() => {})
    setInterval(check, 60 * 60 * 1000)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') check()
    })
  },
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/sala/:code" element={<Lobby />} />
        <Route path="/mesa/:code" element={<Table />} />
        <Route path="/ranking" element={<Ranking />} />
        <Route path="/demo" element={<Table useData={useDemoRoom} />} />
      </Routes>
      <Toaster />
    </BrowserRouter>
  </React.StrictMode>
)

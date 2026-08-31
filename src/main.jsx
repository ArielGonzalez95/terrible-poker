import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './styles.css'
import Home from './screens/Home.jsx'
import Lobby from './screens/Lobby.jsx'
import Table from './screens/Table.jsx'
import Toaster from './components/Toaster.jsx'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/sala/:code" element={<Lobby />} />
        <Route path="/mesa/:code" element={<Table />} />
      </Routes>
      <Toaster />
    </BrowserRouter>
  </React.StrictMode>
)

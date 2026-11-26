import React from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
import './styles.css'
import { Login } from './components/Login'
const U = [
  { id: 'andi.prod', n: 'Andi Saputra', dept: 'Produksi', role: 'User' }, { id: 'siti.prod', n: 'Siti Rahma', dept: 'Produksi', role: 'User' },
  { id: 'budi.spv', n: 'Budi Hartono', dept: 'Produksi', role: 'Atasan' }, { id: 'dewi.admin', n: 'Dewi Lestari', dept: 'Produksi', role: 'Admin Dept' },
  { id: 'wati.wh', n: 'Wati Handayani', dept: 'Warehouse', role: 'Admin Warehouse' }, { id: 'agus.spv', n: 'Agus Prasetyo', dept: 'Warehouse', role: 'Spv Warehouse' },
]
const mode = new URLSearchParams(location.search).get('m')
const load = mode === 'loading' ? () => new Promise(() => {}) : mode === 'fallback' ? async () => ({ ok: false }) : async () => ({ ok: true, users: U })
createRoot(document.getElementById('root')).render(<Login signIn={async () => ({ ok: false, err: 'ID atau PIN salah.' })} loadUsers={load} />)

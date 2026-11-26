// Layar login: pengguna MEMILIH namanya dari daftar (mode Supabase), dengan kotak ketik ID sebagai cadangan.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { Login } from '../components/Login'

const USERS = [
  { id: 'wati.wh', n: 'Wati Handayani', dept: 'Warehouse', role: 'Admin Warehouse' },
  { id: 'andi.prod', n: 'Andi Saputra', dept: 'Produksi', role: 'User' },
  { id: 'budi.spv', n: 'Budi Hartono', dept: 'Produksi', role: 'Atasan' },
  { id: 'siti.prod', n: 'Siti Rahma', dept: 'Produksi', role: 'User' },
]
beforeEach(() => cleanup())

describe('Login mode Supabase: pilih pengguna dari daftar', () => {
  it('menampilkan daftar pilihan (bukan kotak ketik), dikelompokkan menurut peran dengan urutan baku', async () => {
    render(<Login signIn={vi.fn()} loadUsers={async () => ({ ok: true, users: USERS })} />)
    const sel = await screen.findByLabelText('Pengguna')
    await waitFor(() => expect(sel.disabled).toBe(false))
    expect(sel.tagName).toBe('SELECT')
    expect(screen.queryByLabelText('ID pengguna')).toBeNull()
    expect([...sel.querySelectorAll('optgroup')].map(g => g.label)).toEqual(['User', 'Atasan', 'Admin Warehouse'])
    expect([...sel.querySelectorAll('option')].map(o => o.textContent)).toContain('Andi Saputra (Produksi)')
    // di dalam kelompok diurutkan menurut nama
    const users = [...sel.querySelectorAll('optgroup')[0].querySelectorAll('option')].map(o => o.textContent)
    expect(users).toEqual(['Andi Saputra (Produksi)', 'Siti Rahma (Produksi)'])
  })

  it('selama daftar dimuat: pilihan dinonaktifkan dengan keterangan, tidak melompat jadi kotak ketik', async () => {
    let done
    const p = new Promise(r => (done = r))
    render(<Login signIn={vi.fn()} loadUsers={() => p} />)
    const sel = screen.getByLabelText('Pengguna')
    expect(sel.disabled).toBe(true)
    expect(sel.textContent).toMatch(/Memuat daftar pengguna/)
    expect(screen.queryByLabelText('ID pengguna')).toBeNull()
    done({ ok: true, users: USERS })
    await waitFor(() => expect(sel.disabled).toBe(false))
  })

  it('memilih pengguna lalu mengisi PIN memanggil signIn(id, pin)', async () => {
    const signIn = vi.fn(async () => ({ ok: true, id: 'andi.prod' }))
    render(<Login signIn={signIn} loadUsers={async () => ({ ok: true, users: USERS })} />)
    const sel = await screen.findByLabelText('Pengguna')
    await waitFor(() => expect(sel.disabled).toBe(false))
    fireEvent.change(sel, { target: { value: 'andi.prod' } })
    fireEvent.change(screen.getByLabelText('PIN'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Login' }))
    await waitFor(() => expect(signIn).toHaveBeenCalledWith('andi.prod', '123456'))
  })

  it('submit tanpa memilih pengguna: pesan jelas, fokus ke pilihan, signIn tidak dipanggil', async () => {
    const signIn = vi.fn()
    render(<Login signIn={signIn} loadUsers={async () => ({ ok: true, users: USERS })} />)
    const sel = await screen.findByLabelText('Pengguna')
    await waitFor(() => expect(sel.disabled).toBe(false))
    fireEvent.change(screen.getByLabelText('PIN'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Login' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Pilih pengguna dan isi PIN.')
    expect(document.activeElement).toBe(sel)
    expect(sel.getAttribute('aria-invalid')).toBe('true')
    expect(signIn).not.toHaveBeenCalled()
  })

  it('PIN salah: pesan dari server tampil, PIN dikosongkan, pilihan pengguna tetap', async () => {
    const signIn = vi.fn(async () => ({ ok: false, err: 'ID atau PIN salah.' }))
    render(<Login signIn={signIn} loadUsers={async () => ({ ok: true, users: USERS })} />)
    const sel = await screen.findByLabelText('Pengguna')
    await waitFor(() => expect(sel.disabled).toBe(false))
    fireEvent.change(sel, { target: { value: 'budi.spv' } })
    fireEvent.change(screen.getByLabelText('PIN'), { target: { value: '000000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Login' }))
    expect((await screen.findByRole('alert')).textContent).toBe('ID atau PIN salah.')
    expect(screen.getByLabelText('PIN').value).toBe('')
    expect(sel.value).toBe('budi.spv')
  })
})

describe('cadangan: kotak ketik ID bila daftar tidak tersedia', () => {
  it('fungsi login_users belum dibuat ({ok:false}) => kotak ketik ID', async () => {
    render(<Login signIn={vi.fn()} loadUsers={async () => ({ ok: false })} />)
    expect(await screen.findByLabelText('ID pengguna')).toBeTruthy()
    expect(screen.queryByLabelText('Pengguna')).toBeNull()
  })
  it('daftar kosong => kotak ketik ID', async () => {
    render(<Login signIn={vi.fn()} loadUsers={async () => ({ ok: true, users: [] })} />)
    expect(await screen.findByLabelText('ID pengguna')).toBeTruthy()
  })
  it('loadUsers melempar galat => kotak ketik ID (tidak macet di "memuat")', async () => {
    render(<Login signIn={vi.fn()} loadUsers={async () => { throw new Error('jaringan') }} />)
    expect(await screen.findByLabelText('ID pengguna')).toBeTruthy()
  })
  it('tanpa loadUsers (perilaku lama) => kotak ketik ID, pesan lama', async () => {
    const signIn = vi.fn()
    render(<Login signIn={signIn} />)
    fireEvent.click(screen.getByRole('button', { name: 'Login' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Isi ID pengguna dan PIN.')
    expect(signIn).not.toHaveBeenCalled()
  })
})

describe('mode demo tidak berubah', () => {
  it('tanpa signIn: tetap memilih dari users yang diberikan', () => {
    const onPick = vi.fn()
    render(<Login users={USERS} onPick={onPick} />)
    fireEvent.change(screen.getByLabelText('Pengguna'), { target: { value: 'wati.wh' } })
    fireEvent.click(screen.getByRole('button', { name: 'Login' }))
    expect(onPick).toHaveBeenCalledWith('wati.wh')
  })
})

// Tiruan (mock) Google Sheets/Lock/Cache/Properties di memori, untuk menguji backend/dist/Code.gs.
import fs from 'node:fs'
import vm from 'node:vm'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

export function createBackend(codePath = path.join(root, 'backend/dist/Code.gs')) {
  const code = fs.readFileSync(codePath, 'utf8')
  const env = { lockBusy: false, hooks: {}, counts: {}, props: new Map(), cache: new Map(), sheets: new Map() }
  const bump = k => (env.counts[k] = (env.counts[k] || 0) + 1)

  class Range {
    constructor(sh, r, c, nr = 1, nc = 1) { Object.assign(this, { sh, r, c, nr, nc }) }
    getRow() { return this.r }
    getValues() {
      bump('getValues')
      const out = []
      for (let i = 0; i < this.nr; i++) {
        const row = []
        for (let j = 0; j < this.nc; j++) {
          const v = (this.sh.cells[this.r - 1 + i] || [])[this.c - 1 + j]
          row.push(v === undefined ? '' : v)
        }
        out.push(row)
      }
      return out
    }
    setValues(vals) {
      bump('setValues')
      if (env.hooks.setValues && env.hooks.setValues(this.sh.name, this.r, this.c, vals) === 'drop') return this
      if (vals.length !== this.nr || vals.some(v => v.length !== this.nc)) throw new Error('dimensi tidak cocok')
      if (this.r + this.nr - 1 > this.sh.maxRows) throw new Error('Range di luar batas sheet')
      vals.forEach((row, i) => {
        const rr = (this.sh.cells[this.r - 1 + i] = this.sh.cells[this.r - 1 + i] || [])
        row.forEach((v, j) => (rr[this.c - 1 + j] = v))
      })
      return this
    }
    setNumberFormat() { return this }
    setFontWeight() { return this }
    createTextFinder(text) {
      const self = this
      const f = {
        _entire: false,
        matchEntireCell(b) { f._entire = b; return f },
        matchCase() { return f },
        _all() {
          const hits = []
          for (let i = 0; i < self.nr; i++)
            for (let j = 0; j < self.nc; j++) {
              const v = (self.sh.cells[self.r - 1 + i] || [])[self.c - 1 + j]
              if (v !== undefined && (f._entire ? String(v) === text : String(v).includes(text))) hits.push(new Range(self.sh, self.r + i, self.c + j))
            }
          return hits
        },
        findNext() { return f._all()[0] || null },
        findAll() { return f._all() },
      }
      return f
    }
  }
  class Sheet {
    constructor(name) { this.name = name; this.cells = []; this.maxRows = 1000 }
    getLastRow() {
      for (let i = this.cells.length - 1; i >= 0; i--) if ((this.cells[i] || []).some(v => v !== '' && v !== undefined)) return i + 1
      return 0
    }
    getMaxRows() { return this.maxRows }
    insertRowsAfter(_a, n) { this.maxRows += n }
    getRange(r, c, nr = 1, nc = 1) { return new Range(this, r, c, nr, nc) }
    deleteRow(r) { this.cells.splice(r - 1, 1) }
    setFrozenRows() {}
    protect() { return { setWarningOnly() {} } }
  }
  const ss = {
    getSheetByName: n => env.sheets.get(n) || null,
    insertSheet: n => { const s = new Sheet(n); env.sheets.set(n, s); return s },
    getSheets: () => [...env.sheets.values()],
    deleteSheet: () => {},
  }
  const mocks = {
    console,
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, openById: () => ss, flush() { bump('flush'); if (env.hooks.flush) env.hooks.flush() } },
    LockService: { getScriptLock: () => ({ tryLock: () => !env.lockBusy, releaseLock() {} }) },
    CacheService: {
      getScriptCache: () => ({
        get: k => (env.cache.has(k) ? env.cache.get(k) : null),
        put: (k, v) => env.cache.set(k, v),
        putAll: o => Object.entries(o).forEach(([k, v]) => env.cache.set(k, v)),
        getAll: ks => Object.fromEntries(ks.filter(k => env.cache.has(k)).map(k => [k, env.cache.get(k)])),
        remove: k => env.cache.delete(k),
      }),
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (env.props.has(k) ? env.props.get(k) : null), setProperty: (k, v) => env.props.set(k, v) }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: s => ({ setMimeType() { return this }, getContent: () => s }) },
    Utilities: { formatDate: d => d.toISOString().slice(0, 16) },
    Session: { getScriptTimeZone: () => 'Asia/Jakarta' },
  }
  const ctx = vm.createContext({ ...mocks })
  vm.runInContext(code, ctx)
  const $ = expr => vm.runInContext(expr, ctx)


  return { env, ctx, $, ss }
}

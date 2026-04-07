import { useState, useEffect, useRef } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────

interface QueryDef {
  text: string
  route: 'engram' | 'llm'
  result: string
  elapsed: number
}

interface QueryEntry extends QueryDef {
  id: number
  state: 'arriving' | 'resolved'
}

// ── Query sequences ───────────────────────────────────────────────────────────
// Cold queries: graph is fresh, many LLM fallbacks
// Warm queries: same texts but LLM routes resolved by Engram (graph learned)

const COLD: QueryDef[] = [
  { text: 'build failed: missing dependency react-dom',      route: 'llm',    result: 'Run npm ci and clear the node_modules cache',              elapsed: 1380 },
  { text: '401 unauthorized on staging API',                 route: 'engram', result: 'Token absent or expired — check Authorization header',     elapsed: 58  },
  { text: 'flaky test: 30s timeout on auth service',         route: 'llm',    result: 'Increase jest.setTimeout or mock at the service boundary', elapsed: 1290 },
  { text: 'CORS blocked on dashboard.corp.com',              route: 'engram', result: 'Add Access-Control-Allow-Origin on the server',            elapsed: 52  },
  { text: 'deploy failed: health check returned 503',        route: 'llm',    result: 'App not ready — check startup sequence and liveness probe',elapsed: 1410 },
  { text: 'connection pool exhausted after deploy',          route: 'engram', result: 'Scale min_connections to 20, check pool timeout config',   elapsed: 64  },
  { text: 'rate limit 429 on search service',                route: 'engram', result: 'Back off and retry after Retry-After header value',        elapsed: 57  },
  { text: 'SSL handshake failed in webhook receiver',        route: 'llm',    result: 'Certificate CN mismatch — verify SAN entries match host',  elapsed: 1350 },
  { text: 'OOM kill on api-worker-7d8f9 pod',                route: 'engram', result: 'Increase container memory limit or locate the leak',       elapsed: 62  },
  { text: 'migration failed: column already exists',         route: 'engram', result: 'Mark migration as applied or squash conflicting versions', elapsed: 60  },
  { text: '401 on OAuth callback redirect endpoint',         route: 'engram', result: 'Token absent or expired — check Authorization header',     elapsed: 49  },
  { text: 'webpack build timeout: exceeded 300s in CI',      route: 'llm',    result: 'Split chunks or increase CI runner memory and timeout',    elapsed: 1320 },
  { text: 'CORS error on api.internal:8080',                 route: 'engram', result: 'Add Access-Control-Allow-Origin on the server',            elapsed: 53  },
  { text: 'connection timeout to redis:6379',                route: 'engram', result: 'Scale connection pool or verify firewall rules',           elapsed: 55  },
  { text: 'e2e test timeout: login flow 30s exceeded',       route: 'engram', result: 'Retry flaky selector or increase Playwright timeout',      elapsed: 59  },
  { text: 'rate limit exceeded on webhook callbacks',        route: 'engram', result: 'Implement exponential backoff with jitter',                elapsed: 47  },
  { text: 'missing env var DATABASE_URL in production',      route: 'engram', result: 'Add to secrets manager and redeploy the service',          elapsed: 54  },
  { text: 'CrashLoopBackOff: api-worker-7d8f9',              route: 'engram', result: 'Check startup logs — misconfigured secret or port',        elapsed: 61  },
  { text: 'network timeout to auth.internal:443',            route: 'engram', result: 'Check firewall rules, VPN routing, and security groups',   elapsed: 56  },
  { text: 'image pull rate limit hit: Docker Hub',           route: 'llm',    result: 'Configure Docker Hub credentials in cluster secrets',      elapsed: 1310 },
]

// Warm: LLM routes become Engram hits (graph learned from loop 1)
const WARM: QueryDef[] = COLD.map(q =>
  q.route === 'llm'
    ? { ...q, route: 'engram' as const, elapsed: 45 + Math.floor(Math.random() * 25) }
    : q
)

const QUERY_INTERVAL = 950   // ms between queries
const LLM_RESOLVE   = 1350  // ms to simulate LLM latency
const MAX_ROWS      = 13    // rows kept in DOM

// ── Helpers ───────────────────────────────────────────────────────────────────

function RouteChip({ route }: { route: 'engram' | 'llm' }) {
  return route === 'engram' ? (
    <span style={{
      fontSize: '11px', fontWeight: 600, color: '#16a34a',
      background: '#f0fdf4', border: '1px solid #bbf7d0',
      borderRadius: '20px', padding: '1px 8px', whiteSpace: 'nowrap',
    }}>✓ Engram</span>
  ) : (
    <span style={{
      fontSize: '11px', fontWeight: 600, color: '#7c3aed',
      background: '#faf5ff', border: '1px solid #ddd6fe',
      borderRadius: '20px', padding: '1px 8px', whiteSpace: 'nowrap',
    }}>→ LLM</span>
  )
}

function QueryRow({ entry }: { entry: QueryEntry }) {
  const done = entry.state === 'resolved'
  const isEngram = entry.route === 'engram'
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '1fr 90px 68px',
      padding: '6px 14px', borderBottom: '1px solid #f8fafc',
      animation: 'rowIn 0.2s ease both',
    }}>
      <div style={{ minWidth: 0, paddingRight: '8px' }}>
        <div style={{
          fontSize: '12px', fontFamily: 'ui-monospace, monospace',
          color: '#334155', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {entry.text}
        </div>
        {done && (
          <div style={{
            fontSize: '11px', color: '#94a3b8', marginTop: '2px',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            animation: 'fadeIn 0.3s ease both',
          }}>
            {entry.result}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-start', paddingTop: '1px' }}>
        <RouteChip route={entry.route} />
      </div>
      <div style={{
        fontSize: '11px', fontFamily: 'ui-monospace, monospace',
        color: done ? (isEngram ? '#16a34a' : '#7c3aed') : '#cbd5e1',
        paddingTop: '2px',
      }}>
        {done ? `${entry.elapsed}ms` : (entry.route === 'llm' ? '⟳…' : '…')}
      </div>
    </div>
  )
}

function StatBlock({ value, label, color }: { value: number | string; label: string; color: string }) {
  return (
    <div style={{ padding: '10px 20px', minWidth: '110px' }}>
      <div style={{ fontSize: '24px', fontWeight: 700, color, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
        {value}
      </div>
      <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '3px' }}>{label}</div>
    </div>
  )
}

// ── Main ─────────────────────────────────────────────────────────────────────

export default function LLMCostFilter() {
  const [entries, setEntries]   = useState<QueryEntry[]>([])
  const [stats, setStats]       = useState({ engram: 0, llm: 0 })
  const timers     = useRef<ReturnType<typeof setTimeout>[]>([])
  const idRef      = useRef(0)
  const scrollRef  = useRef<HTMLDivElement>(null)

  function clearAll() { timers.current.forEach(clearTimeout); timers.current = [] }

  function fire(qDef: QueryDef) {
    const id = idRef.current++
    setEntries(prev => [...prev.slice(-(MAX_ROWS - 1)), { id, ...qDef, state: 'arriving' }])
    const resolveMs = qDef.route === 'engram' ? qDef.elapsed : LLM_RESOLVE
    const t = setTimeout(() => {
      setEntries(prev => prev.map(e => e.id === id ? { ...e, state: 'resolved' } : e))
      setStats(prev => qDef.route === 'engram'
        ? { ...prev, engram: prev.engram + 1 }
        : { ...prev, llm: prev.llm + 1 }
      )
    }, resolveMs)
    timers.current.push(t)
  }

  function runLoop(loopIndex: number) {
    const queries = loopIndex === 0 ? COLD : WARM
    queries.forEach((q, i) => {
      const t = setTimeout(() => fire(q), i * QUERY_INTERVAL)
      timers.current.push(t)
    })
    const loopDuration = queries.length * QUERY_INTERVAL + 3500 // 3.5s pause
    const t = setTimeout(() => runLoop(loopIndex + 1), loopDuration)
    timers.current.push(t)
  }

  useEffect(() => {
    const t = setTimeout(() => runLoop(0), 400)
    timers.current.push(t)
    return clearAll
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [entries.length])

  const total    = stats.engram + stats.llm
  const savedPct = total > 0 ? Math.round((stats.engram / total) * 100) : 0

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: '14px 20px', gap: '10px' }}>

      {/* Panel header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div>
          <span style={{ fontSize: '13px', fontWeight: 600, color: '#0f172a' }}>
            CI/CD Triage — Live Query Routing
          </span>
          <span style={{ fontSize: '12px', color: '#94a3b8', marginLeft: '10px' }}>
            graph warms up as sessions accumulate
          </span>
        </div>
        <div style={{ display: 'flex', gap: '6px' }}>
          <span style={{ fontSize: '11px', fontWeight: 600, color: '#16a34a', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '20px', padding: '3px 10px' }}>
            ✓ Engram — instant
          </span>
          <span style={{ fontSize: '11px', fontWeight: 600, color: '#7c3aed', background: '#faf5ff', border: '1px solid #ddd6fe', borderRadius: '20px', padding: '3px 10px' }}>
            → LLM — 1–2s latency
          </span>
        </div>
      </div>

      {/* Query feed */}
      <div style={{
        flex: 1, minHeight: 0, overflow: 'hidden',
        background: '#fff', border: '1px solid #e2e8f0', borderRadius: '10px',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Column headers */}
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 90px 68px',
          padding: '7px 14px', borderBottom: '1px solid #f1f5f9',
          background: '#f8fafc', flexShrink: 0,
        }}>
          {['Query', 'Route', 'Time'].map(h => (
            <span key={h} style={{
              fontSize: '10px', fontWeight: 700, color: '#94a3b8',
              letterSpacing: '0.07em', textTransform: 'uppercase',
            }}>
              {h}
            </span>
          ))}
        </div>
        {/* Rows */}
        <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto' }}>
          {entries.length === 0 && (
            <div style={{ padding: '32px', textAlign: 'center', fontSize: '12px', color: '#cbd5e1' }}>
              Starting…
            </div>
          )}
          {entries.map(e => <QueryRow key={e.id} entry={e} />)}
        </div>
      </div>

      {/* Stats bar */}
      <div style={{
        flexShrink: 0, display: 'flex', alignItems: 'stretch',
        background: '#fff', border: '1px solid #e2e8f0', borderRadius: '10px',
        overflow: 'hidden',
      }}>
        <StatBlock value={stats.engram} label="Handled by Engram" color="#16a34a" />
        <div style={{ width: '1px', background: '#e2e8f0' }} />
        <StatBlock value={stats.llm} label="API calls made" color="#7c3aed" />
        <div style={{ width: '1px', background: '#e2e8f0' }} />

        {/* Savings progress */}
        <div style={{ flex: 1, padding: '10px 20px', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '5px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span style={{ fontSize: '11px', color: '#94a3b8' }}>
              {total > 0
                ? `${stats.engram} of ${total} queries resolved without an API call`
                : 'Waiting for queries…'}
            </span>
            <span style={{ fontSize: '22px', fontWeight: 700, color: '#0369a1', fontVariantNumeric: 'tabular-nums' }}>
              {savedPct}%
            </span>
          </div>
          <div style={{ height: '6px', borderRadius: '3px', background: '#f1f5f9', overflow: 'hidden' }}>
            <div style={{
              height: '100%', borderRadius: '3px',
              width: `${savedPct}%`,
              background: savedPct > 70
                ? 'linear-gradient(to right, #16a34a, #22c55e)'
                : savedPct > 40
                  ? 'linear-gradient(to right, #0369a1, #38bdf8)'
                  : 'linear-gradient(to right, #7c3aed, #a78bfa)',
              transition: 'width 0.6s ease, background 1s ease',
            }} />
          </div>
        </div>
      </div>
    </div>
  )
}

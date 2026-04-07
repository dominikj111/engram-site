import { useState, useEffect, useRef } from 'react'

// ── Data ──────────────────────────────────────────────────────────────────────

interface Session {
  user: string
  email: string
  time: string
  text: string
  nodes: string[]
  path: string
  w0: number
  w1: number
}

const SESSIONS: Session[] = [
  {
    user: 'alice', email: 'alice@corp.com', time: '14:02',
    text: 'auth service keeps returning 401 on staging',
    nodes: ['auth', '401', 'staging'],
    path: 'auth → 401 → check_token_expiry',
    w0: 0.82, w1: 0.84,
  },
  {
    user: 'bob', email: 'bob@corp.com', time: '14:07',
    text: 'CORS blocked on the dashboard API',
    nodes: ['cors', 'dashboard', 'api'],
    path: 'cors → add_allow_origin',
    w0: 0.88, w1: 0.90,
  },
  {
    user: 'alice', email: 'alice@corp.com', time: '14:09',
    text: 'I think it might be the token expiry config',
    nodes: ['token', 'expiry', 'config'],
    path: 'token → check_expiry_setting',
    w0: 0.65, w1: 0.68,
  },
  {
    user: 'carol', email: 'carol@corp.com', time: '14:15',
    text: '401 on the webhook endpoint as well',
    nodes: ['auth', '401', 'webhook'],
    path: 'auth → 401 → check_token_expiry',
    w0: 0.84, w1: 0.87,
  },
  {
    user: 'dave', email: 'dave@corp.com', time: '14:22',
    text: 'CORS still blocked after adding the header',
    nodes: ['cors', 'header', 'blocked'],
    path: 'cors → add_allow_origin → verify_preflight',
    w0: 0.90, w1: 0.92,
  },
]

const SESSION_GAP    = 2600  // ms between sessions
const RESET_PAUSE    = 5000  // ms before loop restarts

// ── Engram entry (self-animating) ─────────────────────────────────────────────

function EngramEntry({ session }: { session: Session }) {
  const [phase, setPhase] = useState(0)

  useEffect(() => {
    const ts = [
      setTimeout(() => setPhase(1), 300),   // tokenise + nodes
      setTimeout(() => setPhase(2), 700),   // fade text
      setTimeout(() => setPhase(3), 1000),  // "discarded"
      setTimeout(() => setPhase(4), 1300),  // graph update
    ]
    return () => ts.forEach(clearTimeout)
  }, [])

  return (
    <div style={{
      padding: '8px 10px', borderRadius: '8px', marginBottom: '4px',
      animation: 'rowIn 0.25s ease both',
      background: '#f0fdf408', border: '1px solid #dcfce7',
    }}>
      {/* Original text — fades and strikes through */}
      <div style={{
        fontSize: '11px', color: '#334155', fontStyle: 'italic', marginBottom: '4px',
        opacity: phase >= 2 ? 0.12 : 1,
        textDecoration: phase >= 2 ? 'line-through' : 'none',
        transition: 'opacity 0.4s ease',
      }}>
        "{session.text}"
      </div>

      {phase >= 1 && (
        <div style={{ animation: 'rowIn 0.2s ease both', marginBottom: '4px' }}>
          <div style={{
            fontSize: '10px', color: '#94a3b8', marginBottom: '4px',
            fontFamily: 'ui-monospace, monospace',
          }}>
            ↓ tokenise
          </div>
          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
            {session.nodes.map(n => (
              <span key={n} style={{
                fontSize: '10px', fontFamily: 'ui-monospace, monospace',
                background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#15803d',
                padding: '2px 7px', borderRadius: '20px',
              }}>
                node:{n}
              </span>
            ))}
          </div>
        </div>
      )}

      {phase >= 3 && (
        <div style={{
          animation: 'rowIn 0.2s ease both', marginBottom: '4px',
          fontSize: '10px', fontFamily: 'ui-monospace, monospace', color: '#94a3b8',
        }}>
          text discarded <span style={{ color: '#ef4444', fontWeight: 700 }}>✗</span>
        </div>
      )}

      {phase >= 4 && (
        <div style={{ animation: 'rowIn 0.2s ease both' }}>
          <span style={{ fontSize: '10px', fontFamily: 'ui-monospace, monospace', color: '#15803d' }}>
            {session.path}
          </span>
          <span style={{
            fontSize: '10px', fontFamily: 'ui-monospace, monospace',
            color: '#16a34a', marginLeft: '8px',
          }}>
            ↑ {session.w0.toFixed(2)} → {session.w1.toFixed(2)}
          </span>
        </div>
      )}
    </div>
  )
}

// ── Left panel — Traditional ──────────────────────────────────────────────────

function TraditionalPanel({
  sessions,
  showGdpr,
  showQuery,
}: {
  sessions: Session[]
  showGdpr: boolean
  showQuery: boolean
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [sessions.length])

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      {/* Panel title */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '8px',
        marginBottom: '8px', flexShrink: 0,
      }}>
        <span style={{
          fontSize: '11px', fontWeight: 700, color: '#dc2626',
          textTransform: 'uppercase', letterSpacing: '0.08em',
        }}>
          Traditional Approach
        </span>
        {showGdpr && (
          <span style={{
            fontSize: '10px', fontWeight: 700, color: '#dc2626',
            background: '#fef2f2', border: '1px solid #fecaca',
            borderRadius: '4px', padding: '2px 6px',
            animation: 'pulseGlow 2s ease-in-out infinite',
          }}>
            ⚠ GDPR AUDIT RISK
          </span>
        )}
      </div>

      <div style={{
        flex: 1, minHeight: 0, overflow: 'hidden',
        background: '#fff', border: '1px solid #fecaca',
        borderRadius: '10px', display: 'flex', flexDirection: 'column',
      }}>
        <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
          {sessions.length === 0 && (
            <div style={{ padding: '24px', textAlign: 'center', fontSize: '12px', color: '#cbd5e1' }}>
              Waiting…
            </div>
          )}
          {sessions.map((s, i) => (
            <div key={i} style={{
              padding: '8px 10px', borderRadius: '8px', marginBottom: '4px',
              animation: 'rowIn 0.25s ease both',
              background: '#fef2f2', border: '1px solid #fee2e2',
            }}>
              <div style={{
                display: 'flex', justifyContent: 'space-between',
                alignItems: 'center', marginBottom: '4px',
              }}>
                <span style={{ fontSize: '11px', fontWeight: 600, color: '#dc2626' }}>
                  {s.email}
                </span>
                <span style={{ fontSize: '10px', color: '#94a3b8', fontFamily: 'ui-monospace, monospace' }}>
                  {s.time}
                </span>
              </div>
              <div style={{ fontSize: '12px', color: '#334155', fontStyle: 'italic' }}>
                "{s.text}"
              </div>
            </div>
          ))}
        </div>

        {showQuery && (
          <div style={{
            borderTop: '1px solid #fee2e2', padding: '10px 12px',
            animation: 'rowIn 0.3s ease both', background: '#fff5f5', flexShrink: 0,
          }}>
            <div style={{ fontSize: '10px', color: '#94a3b8', marginBottom: '6px', fontFamily: 'ui-monospace, monospace' }}>
              $ who_said_what --query "auth 401"
            </div>
            <div style={{ fontSize: '11px', fontFamily: 'ui-monospace, monospace', color: '#dc2626', lineHeight: 1.6 }}>
              alice@corp.com  · 2 messages  ✓<br />
              bob@corp.com    · 1 message   ✓<br />
              carol@corp.com  · 1 message   ✓<br />
              dave@corp.com   · 1 message   ✓
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Right panel — Engram ──────────────────────────────────────────────────────

function EngramPanel({ sessions, showQuery }: { sessions: Session[]; showQuery: boolean }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [sessions.length])

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      {/* Panel title */}
      <div style={{ marginBottom: '8px', flexShrink: 0 }}>
        <span style={{
          fontSize: '11px', fontWeight: 700, color: '#16a34a',
          textTransform: 'uppercase', letterSpacing: '0.08em',
        }}>
          Engram
        </span>
      </div>

      <div style={{
        flex: 1, minHeight: 0, overflow: 'hidden',
        background: '#fff', border: '1px solid #bbf7d0',
        borderRadius: '10px', display: 'flex', flexDirection: 'column',
      }}>
        <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
          {sessions.length === 0 && (
            <div style={{ padding: '24px', textAlign: 'center', fontSize: '12px', color: '#cbd5e1' }}>
              Waiting…
            </div>
          )}
          {sessions.map((s, i) => <EngramEntry key={i} session={s} />)}
        </div>

        {showQuery && (
          <div style={{
            borderTop: '1px solid #dcfce7', padding: '10px 12px',
            animation: 'rowIn 0.3s ease both', background: '#f0fdf4', flexShrink: 0,
          }}>
            <div style={{ fontSize: '10px', color: '#94a3b8', marginBottom: '6px', fontFamily: 'ui-monospace, monospace' }}>
              $ who_said_what --query "auth 401"
            </div>
            <div style={{ fontSize: '12px', color: '#15803d', fontWeight: 600, marginBottom: '2px' }}>
              Query not possible.
            </div>
            <div style={{ fontSize: '11px', color: '#64748b', lineHeight: 1.5 }}>
              Raw input was never stored at any layer.<br />
              The graph holds node activation patterns, not text.
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function PrivacyByArchitecture() {
  const [visibleCount, setVisibleCount] = useState(0)
  const [showGdpr, setShowGdpr]         = useState(false)
  const [showQuery, setShowQuery]       = useState(false)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  function clearAll() { timers.current.forEach(clearTimeout); timers.current = [] }

  function run() {
    // Reveal sessions one at a time
    SESSIONS.forEach((_, i) => {
      const t = setTimeout(() => {
        setVisibleCount(i + 1)
        if (i >= 2) setShowGdpr(true)
      }, 800 + i * SESSION_GAP)
      timers.current.push(t)
    })

    // Show "who said what" after all sessions
    const afterAll = 800 + SESSIONS.length * SESSION_GAP
    const t1 = setTimeout(() => setShowQuery(true), afterAll + 1200)
    timers.current.push(t1)

    // Reset and loop
    const t2 = setTimeout(() => {
      clearAll()
      setVisibleCount(0)
      setShowGdpr(false)
      setShowQuery(false)
      const t3 = setTimeout(run, 400)
      timers.current.push(t3)
    }, afterAll + RESET_PAUSE)
    timers.current.push(t2)
  }

  useEffect(() => {
    const t = setTimeout(run, 500)
    timers.current.push(t)
    return clearAll
  }, [])

  const visible = SESSIONS.slice(0, visibleCount)

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: '14px 20px', gap: '10px' }}>

      {/* Header */}
      <div style={{ flexShrink: 0 }}>
        <span style={{ fontSize: '13px', fontWeight: 600, color: '#0f172a' }}>
          Same 5 sessions — two different architectures
        </span>
        <span style={{ fontSize: '12px', color: '#94a3b8', marginLeft: '10px' }}>
          watching what each system stores
        </span>
      </div>

      {/* Two panels */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: '16px' }}>
        <TraditionalPanel sessions={visible} showGdpr={showGdpr} showQuery={showQuery} />

        {/* VS divider */}
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', gap: '8px', flexShrink: 0,
        }}>
          <div style={{ flex: 1, width: '1px', background: '#e2e8f0' }} />
          <span style={{
            fontSize: '10px', fontWeight: 700, color: '#94a3b8',
            letterSpacing: '0.08em', padding: '4px',
          }}>VS</span>
          <div style={{ flex: 1, width: '1px', background: '#e2e8f0' }} />
        </div>

        <EngramPanel sessions={visible} showQuery={showQuery} />
      </div>

      {/* Key insight */}
      <div style={{
        flexShrink: 0, padding: '10px 14px',
        background: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px',
        display: 'flex', alignItems: 'center', gap: '10px',
      }}>
        <span style={{ fontSize: '14px' }}>🔒</span>
        <span style={{ fontSize: '12px', color: '#475569', lineHeight: 1.5 }}>
          <strong style={{ color: '#0f172a' }}>Structural guarantee, not policy:</strong>{' '}
          user input text crosses the system boundary exactly once — at the tokeniser.
          Downstream storage holds only node IDs and path labels. Attribution is absent by construction.
        </span>
      </div>
    </div>
  )
}

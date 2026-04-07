import { useState, useEffect, useRef } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────

type LineKind = 'thinking' | 'tool-call' | 'tool-response' | 'decision' | 'confirmed' | 'graph-update' | 'direct-hit'

interface TraceLine {
  kind: LineKind
  text: string
  delay: number  // ms after previous line
}

interface GraphEdge {
  path: string
  weight: number
  sessions: number
  updated: boolean
}

// ── Trace sequences ───────────────────────────────────────────────────────────

const AGENT1_ROUND1: TraceLine[] = [
  { kind: 'thinking',       text: 'Analyzing: database timeout on /api/orders',                                  delay: 600  },
  { kind: 'thinking',       text: 'Checking root cause candidates for timeout…',                                  delay: 700  },
  { kind: 'tool-call',      text: 'engram.query({ nodes: ["timeout", "database", "orders"] })',                   delay: 800  },
  { kind: 'tool-response',  text: '{\n  "candidate": "missing_index",\n  "confidence": 0.87,\n  "ruled_out": ["conn_pool", "firewall"],\n  "path": ["timeout","db_config","missing_index"],\n  "sessions_confirming": 31\n}', delay: 1000 },
  { kind: 'decision',       text: 'High confidence (0.87). Skipping exhaustive search.',                          delay: 700  },
  { kind: 'decision',       text: 'Recommending: CREATE INDEX CONCURRENTLY on orders.customer_id',               delay: 500  },
  { kind: 'confirmed',      text: 'Session 32 confirmed  ✓',                                                     delay: 1200 },
  { kind: 'graph-update',   text: 'missing_index  weight 0.87 → 0.89',                                          delay: 500  },
]

const AGENT2_ROUND1: TraceLine[] = [
  { kind: 'thinking',       text: 'Analyzing: 401 Unauthorized on staging auth',                                 delay: 600  },
  { kind: 'tool-call',      text: 'engram.query({ nodes: ["401", "staging", "auth"] })',                         delay: 900  },
  { kind: 'tool-response',  text: '{\n  "candidate": "token_expired",\n  "confidence": 0.91,\n  "ruled_out": ["ip_block", "cors"],\n  "path": ["401","auth_config","token_expired"],\n  "sessions_confirming": 47\n}', delay: 1000 },
  { kind: 'decision',       text: 'Very high confidence (0.91). Direct recommendation.',                          delay: 700  },
  { kind: 'decision',       text: 'Recommending: refresh OAuth token — check expiry in auth.config',             delay: 500  },
  { kind: 'confirmed',      text: 'Session 48 confirmed  ✓',                                                     delay: 1200 },
  { kind: 'graph-update',   text: 'token_expired  weight 0.91 → 0.93',                                          delay: 500  },
]

// Round 2: show that the same problem resolves from graph directly, no reasoning loop
const AGENT1_ROUND2: TraceLine[] = [
  { kind: 'thinking',       text: 'New query: connection timeout on /api/reports…',                              delay: 800  },
  { kind: 'tool-call',      text: 'engram.query({ nodes: ["timeout", "database", "reports"] })',                 delay: 700  },
  { kind: 'tool-response',  text: '{\n  "candidate": "missing_index",\n  "confidence": 0.89,\n  "path": ["timeout","db_config","missing_index"],\n  "sessions_confirming": 32\n}', delay: 800 },
  { kind: 'direct-hit',     text: 'Graph hit — 0 LLM calls. Answer returned in 89ms.',                          delay: 600  },
  { kind: 'confirmed',      text: 'Session 33 confirmed  ✓',                                                     delay: 900  },
  { kind: 'graph-update',   text: 'missing_index  weight 0.89 → 0.91',                                          delay: 400  },
]

const AGENT2_ROUND2: TraceLine[] = [
  { kind: 'thinking',       text: 'New query: 403 Forbidden on prod API gateway…',                               delay: 800  },
  { kind: 'tool-call',      text: 'engram.query({ nodes: ["403", "prod", "gateway", "auth"] })',                 delay: 700  },
  { kind: 'tool-response',  text: '{\n  "candidate": "missing_scope",\n  "confidence": 0.74,\n  "path": ["403","auth_config","missing_scope"],\n  "sessions_confirming": 12\n}', delay: 800 },
  { kind: 'direct-hit',     text: 'Graph hit — 0 LLM calls. Answer returned in 61ms.',                          delay: 600  },
  { kind: 'confirmed',      text: 'Session 49 confirmed  ✓',                                                     delay: 900  },
  { kind: 'graph-update',   text: 'missing_scope  weight 0.74 → 0.77',                                          delay: 400  },
]

const RESET_PAUSE = 5000

// ── Line renderers ────────────────────────────────────────────────────────────

const LINE_STYLES: Record<LineKind, { bg: string; border: string; color: string; icon: string }> = {
  'thinking':      { bg: 'transparent', border: 'transparent', color: '#94a3b8', icon: '◌' },
  'tool-call':     { bg: '#f5f3ff',     border: '#ddd6fe',     color: '#6d28d9', icon: '⤷' },
  'tool-response': { bg: '#faf5ff',     border: '#ddd6fe',     color: '#5b21b6', icon: '' },
  'decision':      { bg: 'transparent', border: 'transparent', color: '#334155', icon: '→' },
  'confirmed':     { bg: '#f0fdf4',     border: '#bbf7d0',     color: '#15803d', icon: '✓' },
  'graph-update':  { bg: '#f0fdf4',     border: '#bbf7d0',     color: '#16a34a', icon: '↑' },
  'direct-hit':    { bg: '#f0fdf4',     border: '#86efac',     color: '#15803d', icon: '⚡' },
}

function AgentLine({ line }: { line: TraceLine }) {
  const s = LINE_STYLES[line.kind]
  const isResponse = line.kind === 'tool-response'

  return (
    <div style={{
      animation: 'rowIn 0.2s ease both',
      padding: isResponse ? '6px 10px' : '3px 6px',
      borderRadius: '6px',
      background: s.bg,
      border: s.border !== 'transparent' ? `1px solid ${s.border}` : undefined,
      marginBottom: '3px',
    }}>
      {isResponse ? (
        <pre style={{
          margin: 0, fontSize: '10px', fontFamily: 'ui-monospace, monospace',
          color: s.color, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        }}>
          {line.text}
        </pre>
      ) : (
        <div style={{ display: 'flex', gap: '6px', alignItems: 'flex-start' }}>
          <span style={{ fontSize: '11px', color: s.color, flexShrink: 0, marginTop: '1px' }}>
            {s.icon}
          </span>
          <span style={{
            fontSize: line.kind === 'tool-call' ? '10px' : '12px',
            fontFamily: line.kind === 'tool-call' ? 'ui-monospace, monospace' : 'inherit',
            color: s.color, lineHeight: 1.4,
          }}>
            {line.text}
          </span>
        </div>
      )}
    </div>
  )
}

// ── Agent panel ───────────────────────────────────────────────────────────────

function AgentPanel({
  title,
  subtitle,
  lines,
  isPlaying,
}: {
  title: string
  subtitle: string
  lines: TraceLine[]
  isPlaying: boolean
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lines.length])

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <div style={{ marginBottom: '8px', flexShrink: 0 }}>
        <span style={{ fontSize: '12px', fontWeight: 600, color: '#0f172a' }}>{title}</span>
        <span style={{ fontSize: '11px', color: '#94a3b8', marginLeft: '8px' }}>{subtitle}</span>
      </div>
      <div style={{
        flex: 1, minHeight: 0,
        background: '#fff', border: '1px solid #e2e8f0', borderRadius: '10px',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {/* Terminal bar */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: '5px',
          padding: '7px 10px', borderBottom: '1px solid #f1f5f9', background: '#f8fafc', flexShrink: 0,
        }}>
          {['#e2e8f0', '#e2e8f0', '#e2e8f0'].map((c, i) => (
            <div key={i} style={{ width: '9px', height: '9px', borderRadius: '50%', background: c }} />
          ))}
          <span style={{ fontSize: '10px', color: '#94a3b8', marginLeft: '4px', fontFamily: 'ui-monospace, monospace' }}>
            agent — reasoning trace
          </span>
        </div>

        <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '10px' }}>
          {lines.length === 0 && (
            <div style={{ fontSize: '12px', color: '#cbd5e1', textAlign: 'center', padding: '20px' }}>
              Starting…
            </div>
          )}
          {lines.map((l, i) => <AgentLine key={i} line={l} />)}

          {isPlaying && lines.length > 0 && (
            <div style={{ display: 'flex', gap: '3px', padding: '4px 6px' }}>
              {[0, 1, 2].map(i => (
                <div key={i} style={{
                  width: '5px', height: '5px', borderRadius: '50%', background: '#cbd5e1',
                  animation: `pulseDot 1.2s ${i * 0.2}s ease-in-out infinite`,
                }} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Shared graph ──────────────────────────────────────────────────────────────

function SharedGraph({ edges, sessionCount }: { edges: GraphEdge[]; sessionCount: number }) {
  return (
    <div style={{
      flexShrink: 0,
      background: '#fff', border: '1px solid #e2e8f0', borderRadius: '10px',
      padding: '10px 14px', display: 'flex', alignItems: 'center', gap: '20px',
    }}>
      <div style={{ flexShrink: 0 }}>
        <div style={{ fontSize: '10px', fontWeight: 700, color: '#94a3b8', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: '2px' }}>
          Shared Graph
        </div>
        <div style={{ fontSize: '22px', fontWeight: 700, color: '#16a34a', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
          {sessionCount}
        </div>
        <div style={{ fontSize: '10px', color: '#94a3b8' }}>sessions total</div>
      </div>

      <div style={{ width: '1px', background: '#e2e8f0', alignSelf: 'stretch' }} />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '5px' }}>
        <div style={{ fontSize: '10px', color: '#94a3b8', marginBottom: '2px' }}>
          Both agents contribute to the same graph — shared learning, no shared conversation data
        </div>
        {edges.map((e, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '11px', fontFamily: 'ui-monospace, monospace', color: '#475569', flex: 1 }}>
              {e.path}
            </span>
            <div style={{ width: '80px', height: '4px', borderRadius: '2px', background: '#f1f5f9', overflow: 'hidden' }}>
              <div style={{
                height: '100%', borderRadius: '2px', background: '#16a34a',
                width: `${e.weight * 100}%`, transition: 'width 0.6s ease',
              }} />
            </div>
            <span style={{
              fontSize: '11px', fontFamily: 'ui-monospace, monospace',
              color: e.updated ? '#16a34a' : '#94a3b8',
              fontWeight: e.updated ? 700 : 400, minWidth: '36px',
              transition: 'color 0.3s',
            }}>
              {e.weight.toFixed(2)}
            </span>
            <span style={{ fontSize: '10px', color: '#94a3b8', minWidth: '60px' }}>
              {e.sessions} sessions
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function MCPAgentMemory() {
  const [agent1Lines, setAgent1Lines] = useState<TraceLine[]>([])
  const [agent2Lines, setAgent2Lines] = useState<TraceLine[]>([])
  const [agent1Playing, setAgent1Playing] = useState(false)
  const [agent2Playing, setAgent2Playing] = useState(false)
  const [graphEdges, setGraphEdges] = useState<GraphEdge[]>([
    { path: 'timeout → db_config → missing_index', weight: 0.87, sessions: 31, updated: false },
    { path: 'auth → 401 → token_expired',          weight: 0.91, sessions: 47, updated: false },
    { path: 'auth → 403 → missing_scope',          weight: 0.74, sessions: 12, updated: false },
  ])
  const [sessionCount, setSessionCount] = useState(90)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  function clearAll() { timers.current.forEach(clearTimeout); timers.current = [] }

  function scheduleLines(
    lines: TraceLine[],
    setter: React.Dispatch<React.SetStateAction<TraceLine[]>>,
    setPlaying: React.Dispatch<React.SetStateAction<boolean>>,
    startDelay: number,
    onDone?: () => void,
  ) {
    let cumulative = startDelay
    setPlaying(true)
    lines.forEach((line, i) => {
      cumulative += line.delay
      const t = setTimeout(() => {
        setter(prev => [...prev, line])
        if (i === lines.length - 1) {
          setPlaying(false)
          onDone?.()
        }
      }, cumulative)
      timers.current.push(t)
    })
  }

  function run() {
    // Round 1
    scheduleLines(AGENT1_ROUND1, setAgent1Lines, setAgent1Playing, 400, () => {
      setSessionCount(s => s + 1)
      setGraphEdges(prev => prev.map((e, i) =>
        i === 0 ? { ...e, weight: 0.89, sessions: 32, updated: true } : { ...e, updated: false }
      ))
    })

    // Agent 2 starts 800ms after agent 1
    scheduleLines(AGENT2_ROUND1, setAgent2Lines, setAgent2Playing, 1200, () => {
      setSessionCount(s => s + 1)
      setGraphEdges(prev => prev.map((e, i) =>
        i === 1 ? { ...e, weight: 0.93, sessions: 48, updated: true } : { ...e, updated: false }
      ))
    })

    // Calculate total time for round 1
    const r1Duration = AGENT1_ROUND1.reduce((s, l) => s + l.delay, 0) + 1200 + 2000

    // Round 2: show direct graph hits
    const t1 = setTimeout(() => {
      setAgent1Lines([])
      setAgent2Lines([])
      setGraphEdges(prev => prev.map(e => ({ ...e, updated: false })))

      scheduleLines(AGENT1_ROUND2, setAgent1Lines, setAgent1Playing, 300, () => {
        setSessionCount(s => s + 1)
        setGraphEdges(prev => prev.map((e, i) =>
          i === 0 ? { ...e, weight: 0.91, sessions: 33, updated: true } : { ...e, updated: false }
        ))
      })

      scheduleLines(AGENT2_ROUND2, setAgent2Lines, setAgent2Playing, 1000, () => {
        setSessionCount(s => s + 1)
        setGraphEdges(prev => prev.map((e, i) =>
          i === 2 ? { ...e, weight: 0.77, sessions: 13, updated: true } : { ...e, updated: false }
        ))
      })
    }, r1Duration)
    timers.current.push(t1)

    // Reset
    const r2Duration = r1Duration + AGENT2_ROUND2.reduce((s, l) => s + l.delay, 0) + 1000 + 2500
    const t2 = setTimeout(() => {
      clearAll()
      setAgent1Lines([])
      setAgent2Lines([])
      setAgent1Playing(false)
      setAgent2Playing(false)
      setGraphEdges([
        { path: 'timeout → db_config → missing_index', weight: 0.87, sessions: 31, updated: false },
        { path: 'auth → 401 → token_expired',          weight: 0.91, sessions: 47, updated: false },
        { path: 'auth → 403 → missing_scope',          weight: 0.74, sessions: 12, updated: false },
      ])
      setSessionCount(90)
      const t3 = setTimeout(run, 600)
      timers.current.push(t3)
    }, r2Duration + RESET_PAUSE)
    timers.current.push(t2)
  }

  useEffect(() => {
    const t = setTimeout(run, 500)
    timers.current.push(t)
    return clearAll
  }, [])

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: '14px 20px', gap: '10px' }}>

      {/* Header */}
      <div style={{ flexShrink: 0 }}>
        <span style={{ fontSize: '13px', fontWeight: 600, color: '#0f172a' }}>
          Two LLM agents — one shared knowledge graph
        </span>
        <span style={{ fontSize: '12px', color: '#94a3b8', marginLeft: '10px' }}>
          both call engram.query() at decision points
        </span>
      </div>

      {/* Agent panels */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: '14px' }}>
        <AgentPanel
          title="Agent 1"
          subtitle="infrastructure triage"
          lines={agent1Lines}
          isPlaying={agent1Playing}
        />
        <AgentPanel
          title="Agent 2"
          subtitle="auth debugging"
          lines={agent2Lines}
          isPlaying={agent2Playing}
        />
      </div>

      {/* Shared graph */}
      <SharedGraph edges={graphEdges} sessionCount={sessionCount} />
    </div>
  )
}

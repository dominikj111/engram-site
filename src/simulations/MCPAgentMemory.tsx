import { useState, useEffect, useRef, useCallback } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────

type ResolutionKind = 'local' | 'llm' | 'cross-agent'
type EventPhase     = 'problem' | 'querying' | 'resolved'

interface AgentEventDef {
  agent:         'Agent 1' | 'Agent 2'
  round:         string
  problem:       string
  query:         string
  confidence:    number
  confirmations: number
  resolution:    ResolutionKind
  resultLine:    string
  infoLine:      string
  queryDelay:    number
  resolveDelay:  number
}

interface GraphEdge {
  path:     string
  weight:   number
  sessions: number
  updated:  boolean
  isNew?:   boolean
}

type FeedEntry =
  | { id: number; kind: 'event';     def: AgentEventDef; phase: EventPhase }
  | { id: number; kind: 'separator'; label: string; sub: string }

// ── Sequence data ─────────────────────────────────────────────────────────────

const SEQUENCE: AgentEventDef[] = [
  {
    agent: 'Agent 1', round: 'Round 1',
    problem: 'Database timeout on /api/orders during peak traffic.',
    query: 'engram.query({ nodes: ["timeout", "database", "orders"] })',
    confidence: 0.87, confirmations: 31,
    resolution: 'local',
    resultLine: 'CREATE INDEX CONCURRENTLY on orders.customer_id',
    infoLine: 'LLM: 0 calls · weight 0.91 → 0.93 · path reinforced',
    queryDelay: 700, resolveDelay: 1100,
  },
  {
    agent: 'Agent 2', round: 'Round 1',
    problem: 'Intermittent 504 on /api/payments under high concurrency.',
    query: 'engram.query({ nodes: ["504", "payments", "load", "timeout"] })',
    confidence: 0.31, confirmations: 3,
    resolution: 'llm',
    resultLine: 'gateway_concurrency fix applied to /api/payments',
    infoLine: 'LLM identifies gateway_concurrency · new path created · weight 0.50',
    queryDelay: 600, resolveDelay: 1600,
  },
  {
    agent: 'Agent 1', round: 'Round 2',
    problem: '504 errors on /api/checkout under load — same concurrency pattern.',
    query: 'engram.query({ nodes: ["504", "gateway", "checkout", "load"] })',
    confidence: 0.55, confirmations: 1,
    resolution: 'cross-agent',
    resultLine: 'gateway_concurrency fix applied — zero LLM calls',
    infoLine: 'source: Agent 2 shared graph · weight 0.55 → 0.58',
    queryDelay: 600, resolveDelay: 1000,
  },
  {
    agent: 'Agent 2', round: 'Round 2',
    problem: 'Connection timeout on /api/reports.',
    query: 'engram.query({ nodes: ["timeout", "database", "reports"] })',
    confidence: 0.89, confirmations: 32,
    resolution: 'cross-agent',
    resultLine: 'CREATE INDEX on reports.created_at — zero LLM calls',
    infoLine: 'source: Agent 1 shared graph · weight 0.89 → 0.91',
    queryDelay: 600, resolveDelay: 1000,
  },
]

const ENTRY_GAP = 600

// ── Sub-components ────────────────────────────────────────────────────────────

function AgentBadge({ agent }: { agent: 'Agent 1' | 'Agent 2' }) {
  const isA1 = agent === 'Agent 1'
  return (
    <span style={{
      fontSize: '10px', fontWeight: 700, letterSpacing: '0.03em',
      color: isA1 ? '#1d4ed8' : '#6d28d9',
      background: isA1 ? '#eff6ff' : '#faf5ff',
      border: `1px solid ${isA1 ? '#bfdbfe' : '#ddd6fe'}`,
      borderRadius: '4px', padding: '1px 6px',
      fontFamily: 'ui-monospace, monospace',
    }}>
      {agent}
    </span>
  )
}

function ResolutionBadge({ kind }: { kind: ResolutionKind }) {
  if (kind === 'local') return (
    <span style={{
      fontSize: '10px', fontWeight: 600, color: '#16a34a',
      background: '#f0fdf4', border: '1px solid #bbf7d0',
      borderRadius: '20px', padding: '1px 8px',
    }}>✓ Engram</span>
  )
  if (kind === 'llm') return (
    <span style={{
      fontSize: '10px', fontWeight: 600, color: '#7c3aed',
      background: '#faf5ff', border: '1px solid #ddd6fe',
      borderRadius: '20px', padding: '1px 8px',
    }}>→ LLM</span>
  )
  return (
    <span style={{
      fontSize: '10px', fontWeight: 600, color: '#0369a1',
      background: '#e0f2fe', border: '1px solid #bae6fd',
      borderRadius: '20px', padding: '1px 8px',
    }}>↑ cross-agent reuse</span>
  )
}

function EngramCard({ def, phase }: { def: AgentEventDef; phase: EventPhase }) {
  const isLlm   = def.resolution === 'llm'
  const isCross = def.resolution === 'cross-agent'

  const borderColor = isLlm ? '#ddd6fe' : '#bbf7d0'
  const bgColor     = isLlm ? '#faf5ff' : '#f0fdf408'
  const queryColor  = isLlm ? '#6d28d9'  : '#15803d'

  return (
    <div style={{
      marginTop: '3px',
      marginLeft: '16px',
      borderLeft: `2px solid ${borderColor}`,
      paddingLeft: '8px',
      animation: 'rowIn 0.2s ease both',
    }}>
      <div style={{
        padding: '8px 10px', borderRadius: '8px',
        background: bgColor, border: `1px solid ${borderColor}`,
      }}>
        {/* Engram query */}
        <div style={{ marginBottom: '6px' }}>
          <div style={{
            fontSize: '9px', fontWeight: 700, letterSpacing: '0.07em',
            color: '#94a3b8', textTransform: 'uppercase', marginBottom: '3px',
          }}>
            Engram Query
          </div>
          <div style={{
            fontSize: '10px', fontFamily: 'ui-monospace, monospace',
            color: queryColor, wordBreak: 'break-word', lineHeight: 1.45,
          }}>
            {def.query}
          </div>
        </div>

        {/* Confidence row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginBottom: '5px' }}>
          <span style={{
            fontSize: '9px', fontWeight: 700, color: '#94a3b8',
            letterSpacing: '0.07em', textTransform: 'uppercase',
          }}>
            Confidence
          </span>
          <span style={{
            fontSize: '10px', fontFamily: 'ui-monospace, monospace', fontWeight: 700,
            color: def.confidence >= 0.65
              ? '#16a34a'
              : def.confidence >= 0.45
                ? '#d97706'
                : '#dc2626',
          }}>
            {def.confidence.toFixed(2)}
          </span>
          <span style={{ fontSize: '10px', color: '#94a3b8' }}>
            {def.confirmations} confirmations
          </span>
          {isLlm && (
            <span style={{
              fontSize: '10px', fontWeight: 600, color: '#dc2626',
              background: '#fef2f2', border: '1px solid #fecaca',
              borderRadius: '4px', padding: '1px 5px',
            }}>
              below threshold
            </span>
          )}
          {isCross && (
            <span style={{
              fontSize: '10px', fontWeight: 600, color: '#0369a1',
              background: '#e0f2fe', border: '1px solid #bae6fd',
              borderRadius: '4px', padding: '1px 5px',
            }}>
              ↑ cross-agent
            </span>
          )}
        </div>

        {/* Result — shown only when resolved */}
        {phase === 'resolved' && (
          <div style={{ animation: 'rowIn 0.2s ease both' }}>
            <div style={{
              fontSize: '9px', fontWeight: 700, letterSpacing: '0.07em',
              color: '#94a3b8', textTransform: 'uppercase', marginBottom: '3px',
            }}>
              Result
            </div>
            <div style={{
              fontSize: '11px', lineHeight: 1.4,
              color: isLlm ? '#5b21b6' : '#166534',
              marginBottom: '3px',
            }}>
              {def.resultLine}
            </div>
            <div style={{
              fontSize: '10px', fontFamily: 'ui-monospace, monospace', color: '#94a3b8',
            }}>
              {def.infoLine}
            </div>
          </div>
        )}

        {/* Processing dots */}
        {phase === 'querying' && (
          <div style={{ display: 'flex', gap: '3px', paddingTop: '5px' }}>
            {[0, 1, 2].map(i => (
              <div key={i} style={{
                width: '5px', height: '5px', borderRadius: '50%',
                background: isLlm ? '#ddd6fe' : '#bbf7d0',
                animation: `pulseDot 1.2s ${i * 0.2}s ease-in-out infinite`,
              }} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function FeedRow({ entry }: { entry: FeedEntry }) {
  if (entry.kind === 'separator') {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: '8px',
        padding: '8px 10px', margin: '4px 0',
        background: '#f0fdf4', border: '1px solid #dcfce7',
        borderRadius: '8px',
        animation: 'rowIn 0.3s ease both',
      }}>
        <span style={{
          fontSize: '10px', fontWeight: 700,
          color: '#15803d', letterSpacing: '0.06em',
        }}>
          SHARED GRAPH UPDATED
        </span>
        <span style={{
          fontSize: '10px', fontFamily: 'ui-monospace, monospace',
          color: '#15803d', background: '#dcfce7',
          border: '1px solid #bbf7d0', borderRadius: '4px', padding: '1px 7px',
        }}>
          {entry.label}
        </span>
        <span style={{ fontSize: '10px', color: '#64748b', flex: 1 }}>
          {entry.sub}
        </span>
      </div>
    )
  }

  const { def, phase } = entry
  return (
    <div style={{ marginBottom: '10px', animation: 'rowIn 0.25s ease both' }}>
      {/* Problem card */}
      <div style={{
        padding: '8px 10px', borderRadius: '8px',
        background: '#f8fafc', border: '1px solid #e2e8f0',
      }}>
        <div style={{
          display: 'flex', justifyContent: 'space-between',
          alignItems: 'center', marginBottom: '5px',
        }}>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <AgentBadge agent={def.agent} />
            <span style={{
              fontSize: '10px', color: '#94a3b8',
              fontFamily: 'ui-monospace, monospace',
            }}>
              {def.round}
            </span>
          </div>
          {phase === 'resolved' && <ResolutionBadge kind={def.resolution} />}
        </div>
        <div style={{ fontSize: '12px', color: '#334155', lineHeight: 1.4 }}>
          {def.problem}
        </div>
      </div>

      {/* Indented Engram processing */}
      {phase !== 'problem' && <EngramCard def={def} phase={phase} />}
    </div>
  )
}

// ── Shared graph ──────────────────────────────────────────────────────────────

function SharedGraph({ edges, sessionCount }: { edges: GraphEdge[]; sessionCount: number }) {
  return (
    <div style={{
      flexShrink: 0,
      background: '#fff', border: '1px solid #e2e8f0',
      borderRadius: '10px', padding: '10px 14px',
      display: 'flex', alignItems: 'center', gap: '20px',
    }}>
      <div style={{ flexShrink: 0 }}>
        <div style={{
          fontSize: '10px', fontWeight: 700, color: '#94a3b8',
          letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: '2px',
        }}>
          Shared Graph
        </div>
        <div style={{
          fontSize: '22px', fontWeight: 700, color: '#16a34a',
          fontVariantNumeric: 'tabular-nums', lineHeight: 1,
        }}>
          {sessionCount}
        </div>
        <div style={{ fontSize: '10px', color: '#94a3b8' }}>sessions total</div>
      </div>

      <div style={{ width: '1px', background: '#e2e8f0', alignSelf: 'stretch' }} />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '5px' }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0,1fr) 80px 44px 100px',
          gap: '10px', marginBottom: '2px',
        }}>
          {['Path', 'Weight', 'Score', 'Status'].map(h => (
            <span key={h} style={{
              fontSize: '9px', fontWeight: 700, color: '#94a3b8',
              letterSpacing: '0.07em', textTransform: 'uppercase',
            }}>
              {h}
            </span>
          ))}
        </div>
        {edges.map((e, i) => (
          <div key={i} style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0,1fr) 80px 44px 100px',
            gap: '10px', alignItems: 'center',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
              <span style={{
                fontSize: '11px', fontFamily: 'ui-monospace, monospace',
                color: '#475569', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {e.path}
              </span>
              {e.isNew && (
                <span style={{
                  fontSize: '10px', fontWeight: 600, color: '#15803d',
                  background: '#f0fdf4', border: '1px solid #bbf7d0',
                  borderRadius: '8px', padding: '1px 6px', flexShrink: 0,
                }}>
                  new path
                </span>
              )}
            </div>
            <div style={{ width: '80px', height: '4px', borderRadius: '2px', background: '#f1f5f9', overflow: 'hidden' }}>
              <div style={{
                height: '100%', borderRadius: '2px', background: '#16a34a',
                width: `${e.weight * 100}%`, transition: 'width 0.6s ease',
              }} />
            </div>
            <span style={{
              fontSize: '11px', fontFamily: 'ui-monospace, monospace',
              color: e.updated ? '#16a34a' : '#94a3b8',
              fontWeight: e.updated ? 700 : 400,
              transition: 'color 0.3s',
            }}>
              {e.weight.toFixed(2)}
            </span>
            <span style={{ fontSize: '10px', color: '#94a3b8' }}>
              {e.sessions} confirmations
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function MCPAgentMemory({ paused }: { paused?: boolean }) {
  const [feed, setFeed]             = useState<FeedEntry[]>([])
  const [graphEdges, setGraphEdges] = useState<GraphEdge[]>([
    { path: 'timeout → db_config → missing_index', weight: 0.87, sessions: 31, updated: false },
    { path: 'auth → 401 → token_expired',          weight: 0.91, sessions: 47, updated: false },
  ])
  const [sessionCount, setSessionCount] = useState(90)

  const scrollRef  = useRef<HTMLDivElement>(null)
  const timers     = useRef<ReturnType<typeof setTimeout>[]>([])
  const pausedRef  = useRef(paused)
  const entryIdRef = useRef(0)

  useEffect(() => { pausedRef.current = paused }, [paused])

  function clearAll() { timers.current.forEach(clearTimeout); timers.current = [] }

  const sched = useCallback((delay: number, fn: () => void) => {
    if (pausedRef.current) {
      const poll = setInterval(() => {
        if (!pausedRef.current) { clearInterval(poll); sched(delay, fn) }
      }, 100)
      timers.current.push(poll as unknown as ReturnType<typeof setTimeout>)
      return
    }
    const t = setTimeout(fn, delay)
    timers.current.push(t)
  }, [])

  function updateGraph(idx: number) {
    setSessionCount(s => s + 1)
    if (idx === 0) {
      setGraphEdges(prev => prev.map(e =>
        e.path === 'timeout → db_config → missing_index'
          ? { ...e, weight: 0.89, sessions: 32, updated: true }
          : { ...e, updated: false }
      ))
    } else if (idx === 1) {
      setGraphEdges(prev => [
        ...prev.map(e => ({ ...e, updated: false })),
        { path: '504 → load → gateway_concurrency', weight: 0.50, sessions: 1, updated: true, isNew: true },
      ])
    } else if (idx === 2) {
      setGraphEdges(prev => prev.map(e =>
        e.path === '504 → load → gateway_concurrency'
          ? { ...e, weight: 0.55, sessions: 2, updated: true, isNew: false }
          : { ...e, updated: false }
      ))
    } else if (idx === 3) {
      setGraphEdges(prev => prev.map(e =>
        e.path === 'timeout → db_config → missing_index'
          ? { ...e, weight: 0.91, sessions: 33, updated: true }
          : { ...e, updated: false }
      ))
    }
  }

  function run() {
    let t = 400

    SEQUENCE.forEach((def, idx) => {
      const id = entryIdRef.current++

      // 1. Problem card appears
      sched(t, () => {
        setFeed(prev => [...prev, { id, kind: 'event', def, phase: 'problem' }])
      })
      t += def.queryDelay

      // 2. Engram processing starts (querying dots)
      sched(t, () => {
        setFeed(prev => prev.map(e =>
          e.kind === 'event' && e.id === id ? { ...e, phase: 'querying' } : e
        ))
      })
      t += def.resolveDelay

      // 3. Resolved — flip to full result + update shared graph
      sched(t, () => {
        setFeed(prev => prev.map(e =>
          e.kind === 'event' && e.id === id ? { ...e, phase: 'resolved' } : e
        ))
        updateGraph(idx)
      })

      // After Agent 2 Round 1 resolves (idx=1), show graph-updated separator
      if (idx === 1) {
        t += 500
        const sepId = entryIdRef.current++
        sched(t, () => {
          setFeed(prev => [...prev, {
            id: sepId,
            kind: 'separator',
            label: '504 → load → gateway_concurrency',
            sub: '— Agent 2 LLM answer written to shared graph',
          }])
        })
      }

      t += ENTRY_GAP
    })
  }

  useEffect(() => {
    sched(500, run)
    return clearAll
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    if (nearBottom) el.scrollTop = el.scrollHeight
  }, [feed.length])

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: '14px 20px', gap: '10px' }}>

      {/* Header */}
      <div style={{ flexShrink: 0 }}>
        <span style={{ fontSize: '13px', fontWeight: 600, color: '#0f172a' }}>
          Two agents — one shared knowledge graph
        </span>
        <span style={{ fontSize: '12px', color: '#94a3b8', marginLeft: '10px' }}>
          Agent 2's LLM call teaches Agent 1 — no duplicate API calls
        </span>
      </div>

      {/* Feed */}
      <div style={{
        flex: 1, minHeight: 0, overflow: 'hidden',
        background: '#fff', border: '1px solid #e2e8f0',
        borderRadius: '10px', display: 'flex', flexDirection: 'column',
      }}>
        {/* Terminal chrome */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: '5px',
          padding: '7px 10px', borderBottom: '1px solid #f1f5f9',
          background: '#f8fafc', flexShrink: 0,
        }}>
          {['#e2e8f0', '#e2e8f0', '#e2e8f0'].map((c, i) => (
            <div key={i} style={{ width: '9px', height: '9px', borderRadius: '50%', background: c }} />
          ))}
          <span style={{
            fontSize: '10px', color: '#94a3b8', marginLeft: '4px',
            fontFamily: 'ui-monospace, monospace',
          }}>
            event feed — cross-agent memory sharing
          </span>
        </div>

        <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '10px' }}>
          {feed.length === 0 && (
            <div style={{ padding: '24px', textAlign: 'center', fontSize: '12px', color: '#cbd5e1' }}>
              Starting…
            </div>
          )}
          {feed.map(e => <FeedRow key={e.id} entry={e} />)}
        </div>
      </div>

      {/* Shared graph */}
      <SharedGraph edges={graphEdges} sessionCount={sessionCount} />

      <style>{`
        @keyframes rowIn {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes pulseDot {
          0%, 100% { opacity: 0.3; transform: scale(0.8); }
          50%      { opacity: 1;   transform: scale(1.1); }
        }
      `}</style>
    </div>
  )
}

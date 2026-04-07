import { useState, useEffect, useRef } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────

type MsgKind = 'user' | 'processing' | 'bot' | 'breaking' | 'llm-handoff' | 'learning'

interface Msg {
  kind: MsgKind
  text: string
  delay: number
  confidence?: number
  outcome?: 'hit' | 'question' | 'llm'
}

// ── Message sequences ─────────────────────────────────────────────────────────

// Session 1: cold graph — 3 breaking questions, 1 LLM call, 8 messages
const SESSION1: Msg[] = [
  { kind: 'user',       text: 'connection keeps timing out',                                                                delay: 500  },
  { kind: 'processing', text: 'timeout · connection · database', confidence: 0.23, outcome: 'question',                    delay: 800  },
  { kind: 'breaking',   text: 'Is this affecting a database connection or an outbound network call?',                       delay: 600  },
  { kind: 'user',       text: 'database connection — specifically the orders API',                                          delay: 1100 },
  { kind: 'processing', text: 'timeout · db_config · query_pattern', confidence: 0.41, outcome: 'question',                delay: 800  },
  { kind: 'breaking',   text: 'Do the timeouts happen on all queries, or only under high load?',                           delay: 600  },
  { kind: 'user',       text: 'only on complex queries — seems query-specific',                                             delay: 1100 },
  { kind: 'processing', text: 'timeout · db_config · missing_index · lock_contention', confidence: 0.58, outcome: 'llm',  delay: 800  },
  { kind: 'llm-handoff',text: '{ path: ["timeout","db_config"], ruled_out: [], confidence: 0.58, escalate: true }',        delay: 700  },
  { kind: 'bot',        text: 'Missing index on orders.customer_id — full table scan on every query. Add a covering index.', delay: 1000 },
  { kind: 'learning',   text: 'timeout → db_config → missing_index', confidence: 0.50,                                    delay: 600  },
]

// Session 50: warm graph — direct hit, no questions, no LLM
const SESSION50: Msg[] = [
  { kind: 'user',       text: 'connection keeps timing out',                                                                delay: 500  },
  { kind: 'processing', text: 'timeout · db_config · missing_index', confidence: 0.91, outcome: 'hit',                    delay: 700  },
  { kind: 'bot',        text: 'Missing index on orders.customer_id — full table scan on every query. Run:\nCREATE INDEX CONCURRENTLY idx_orders_customer ON orders(customer_id);', delay: 500 },
  { kind: 'learning',   text: 'timeout → db_config → missing_index', confidence: 0.93,                                    delay: 400  },
]

const RESET_PAUSE = 4000

// ── Message bubbles ───────────────────────────────────────────────────────────

function ConfBar({ value, outcome }: { value: number; outcome?: 'hit' | 'question' | 'llm' }) {
  const color = outcome === 'hit' ? '#16a34a' : outcome === 'question' ? '#2563eb' : '#7c3aed'
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', marginLeft: '8px' }}>
      <span style={{
        display: 'inline-block', height: '4px', borderRadius: '2px',
        background: color, opacity: 0.85, minWidth: '4px',
        width: `${Math.round(value * 44)}px`,
      }} />
      <span style={{ color, fontSize: '10px', fontWeight: 700 }}>{value.toFixed(2)}</span>
    </span>
  )
}

function MsgBubble({ msg }: { msg: Msg }) {
  if (msg.kind === 'user') return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', animation: 'rowIn 0.2s ease both' }}>
      <div style={{
        background: '#1e293b', color: '#f1f5f9',
        borderRadius: '14px', borderTopRightRadius: '3px',
        padding: '7px 12px', fontSize: '12px', maxWidth: '220px',
      }}>
        {msg.text}
      </div>
    </div>
  )

  if (msg.kind === 'processing') return (
    <div style={{
      display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '4px',
      padding: '5px 10px', borderRadius: '7px',
      background: '#f8fafc', border: '1px solid #e2e8f0',
      animation: 'rowIn 0.2s ease both',
    }}>
      <span style={{ fontSize: '11px', color: '#94a3b8', fontFamily: 'ui-monospace, monospace' }}>⟳</span>
      <span style={{ fontSize: '11px', color: '#64748b', fontFamily: 'ui-monospace, monospace' }}>{msg.text}</span>
      {msg.confidence !== undefined && <ConfBar value={msg.confidence} outcome={msg.outcome} />}
      {msg.outcome === 'question' && (
        <span style={{ fontSize: '10px', color: '#2563eb', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '20px', padding: '1px 6px' }}>? question</span>
      )}
      {msg.outcome === 'hit' && (
        <span style={{ fontSize: '10px', color: '#16a34a', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '20px', padding: '1px 6px' }}>✓ hit</span>
      )}
      {msg.outcome === 'llm' && (
        <span style={{ fontSize: '10px', color: '#7c3aed', background: '#faf5ff', border: '1px solid #ddd6fe', borderRadius: '20px', padding: '1px 6px' }}>→ LLM</span>
      )}
    </div>
  )

  if (msg.kind === 'bot') return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '6px', animation: 'rowIn 0.2s ease both' }}>
      <div style={{
        width: '22px', height: '22px', borderRadius: '50%',
        background: '#f1f5f9', border: '1px solid #e2e8f0',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '9px', fontWeight: 700, color: '#64748b', flexShrink: 0,
      }}>E</div>
      <div style={{
        background: '#fff', border: '1px solid #e2e8f0',
        borderRadius: '14px', borderTopLeftRadius: '3px',
        padding: '7px 12px', fontSize: '12px', color: '#1e293b',
        maxWidth: '230px', whiteSpace: 'pre-wrap', lineHeight: 1.5,
      }}>
        {msg.text}
      </div>
    </div>
  )

  if (msg.kind === 'breaking') return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '6px', animation: 'rowIn 0.2s ease both' }}>
      <div style={{
        width: '22px', height: '22px', borderRadius: '50%',
        background: '#eff6ff', border: '1px solid #bfdbfe',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '9px', fontWeight: 700, color: '#2563eb', flexShrink: 0,
      }}>E</div>
      <div style={{
        background: '#eff6ff', border: '1px solid #bfdbfe',
        borderRadius: '14px', borderTopLeftRadius: '3px',
        padding: '7px 12px', fontSize: '12px', color: '#1e40af', maxWidth: '230px',
      }}>
        {msg.text}
      </div>
    </div>
  )

  if (msg.kind === 'llm-handoff') return (
    <div style={{ animation: 'rowIn 0.2s ease both', marginLeft: '28px' }}>
      <div style={{
        background: '#faf5ff', border: '1px solid #ddd6fe', borderRadius: '7px',
        padding: '5px 10px',
      }}>
        <div style={{ fontSize: '9px', fontWeight: 700, color: '#7c3aed', letterSpacing: '0.06em', marginBottom: '3px' }}>
          STRUCTURED HANDOFF → LLM
        </div>
        <pre style={{
          margin: 0, fontSize: '10px', fontFamily: 'ui-monospace, monospace',
          color: '#5b21b6', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        }}>
          {msg.text}
        </pre>
      </div>
    </div>
  )

  if (msg.kind === 'learning') return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '6px',
      background: '#f0fdf4', border: '1px solid #bbf7d0',
      borderRadius: '7px', padding: '5px 10px',
      animation: 'rowIn 0.2s ease both',
    }}>
      <span style={{ fontSize: '11px', color: '#16a34a' }}>↑</span>
      <span style={{ fontSize: '10px', fontFamily: 'ui-monospace, monospace', color: '#15803d' }}>
        {msg.text}
      </span>
      {msg.confidence !== undefined && (
        <span style={{ fontSize: '10px', color: '#16a34a', marginLeft: '4px' }}>
          {msg.kind === 'learning' && msg.confidence === 0.50 ? 'weight 0.50 (new path)' : `weight → ${msg.confidence.toFixed(2)}`}
        </span>
      )}
    </div>
  )

  return null
}

// ── Session panel ─────────────────────────────────────────────────────────────

function SessionPanel({
  title,
  accentColor,
  messages,
  isPlaying,
  stats,
}: {
  title: string
  accentColor: string
  messages: Msg[]
  isPlaying: boolean
  stats: { questions: number; llmCalls: number; msgCount: number }
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length])

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <div style={{ marginBottom: '8px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: '13px', fontWeight: 600, color: accentColor }}>{title}</span>
        <div style={{ display: 'flex', gap: '8px' }}>
          <StatPill label="questions" value={stats.questions} color={stats.questions > 0 ? '#2563eb' : '#16a34a'} />
          <StatPill label="LLM calls" value={stats.llmCalls} color={stats.llmCalls > 0 ? '#7c3aed' : '#16a34a'} />
          <StatPill label="messages" value={stats.msgCount} color="#64748b" />
        </div>
      </div>
      <div style={{
        flex: 1, minHeight: 0,
        background: '#fff', border: `1px solid ${accentColor}40`,
        borderRadius: '10px', display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {/* Bar */}
        <div style={{
          padding: '6px 10px', borderBottom: '1px solid #f1f5f9',
          background: '#f8fafc', flexShrink: 0, display: 'flex', alignItems: 'center', gap: '5px',
        }}>
          {['#e2e8f0', '#e2e8f0', '#e2e8f0'].map((c, i) => (
            <div key={i} style={{ width: '8px', height: '8px', borderRadius: '50%', background: c }} />
          ))}
          <span style={{ fontSize: '10px', color: '#94a3b8', marginLeft: '4px', fontFamily: 'ui-monospace, monospace' }}>
            engram — diagnostic session
          </span>
        </div>

        <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {messages.length === 0 && (
            <div style={{ fontSize: '12px', color: '#cbd5e1', textAlign: 'center', padding: '20px' }}>
              Starting…
            </div>
          )}
          {messages.map((m, i) => <MsgBubble key={i} msg={m} />)}

          {isPlaying && messages.length > 0 && (
            <div style={{ display: 'flex', gap: '3px', paddingLeft: '28px' }}>
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

function StatPill({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '4px',
      background: '#f8fafc', border: '1px solid #e2e8f0',
      borderRadius: '20px', padding: '2px 8px',
    }}>
      <span style={{ fontSize: '12px', fontWeight: 700, color, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
      <span style={{ fontSize: '10px', color: '#94a3b8' }}>{label}</span>
    </div>
  )
}

// ── Slider learning curve ─────────────────────────────────────────────────────

function lerp(a: number, b: number, t: number) { return a + (b - a) * t }

function LearningCurve({ session, onSessionChange }: { session: number; onSessionChange: (n: number) => void }) {
  const t = Math.min(1, session / 50)
  // These match the cold→warm curves for this specific domain
  const conf     = lerp(0.23, 0.91, Math.pow(t, 0.5))
  const questions = Math.max(0, Math.round(lerp(3, 0, Math.min(1, t * 3))))
  const llmCalls  = session < 8 ? 1 : 0
  const messages  = Math.max(2, Math.round(lerp(11, 2, Math.pow(t, 0.6))))
  const ms        = Math.round(lerp(8200, 85, Math.pow(t, 0.7)))

  return (
    <div style={{
      flexShrink: 0,
      background: '#fff', border: '1px solid #e2e8f0', borderRadius: '10px',
      padding: '12px 16px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
        <span style={{ fontSize: '12px', fontWeight: 600, color: '#0f172a' }}>
          Session {session} — live stats
        </span>
        <span style={{ fontSize: '11px', color: '#94a3b8', fontStyle: 'italic' }}>
          drag the slider to explore the learning curve
        </span>
      </div>

      {/* Slider */}
      <input
        type="range" min={1} max={50} value={session}
        onChange={e => onSessionChange(Number(e.target.value))}
        style={{ width: '100%', marginBottom: '10px', accentColor: '#7c3aed', cursor: 'pointer' }}
      />

      {/* Stats row */}
      <div style={{ display: 'flex', gap: '0', overflow: 'hidden', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
        {[
          { label: 'Graph confidence', value: conf.toFixed(2), color: conf > 0.75 ? '#16a34a' : conf > 0.4 ? '#2563eb' : '#7c3aed' },
          { label: 'Breaking questions', value: String(questions), color: questions === 0 ? '#16a34a' : '#2563eb' },
          { label: 'LLM calls', value: String(llmCalls), color: llmCalls === 0 ? '#16a34a' : '#7c3aed' },
          { label: 'Messages exchanged', value: String(messages), color: '#64748b' },
          { label: 'Response time', value: ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`, color: ms < 200 ? '#16a34a' : ms < 2000 ? '#2563eb' : '#7c3aed' },
        ].map((stat, i, arr) => (
          <div key={stat.label} style={{
            flex: 1, padding: '8px 12px', textAlign: 'center',
            borderRight: i < arr.length - 1 ? '1px solid #e2e8f0' : undefined,
          }}>
            <div style={{ fontSize: '18px', fontWeight: 700, color: stat.color, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
              {stat.value}
            </div>
            <div style={{ fontSize: '10px', color: '#94a3b8', marginTop: '3px' }}>{stat.label}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function GraphLearns() {
  const [session1Msgs, setSession1Msgs] = useState<Msg[]>([])
  const [session50Msgs, setSession50Msgs] = useState<Msg[]>([])
  const [session1Playing, setSession1Playing] = useState(false)
  const [session50Playing, setSession50Playing] = useState(false)
  const [sliderSession, setSliderSession] = useState(1)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  function clearAll() { timers.current.forEach(clearTimeout); timers.current = [] }

  function scheduleSession(
    msgs: Msg[],
    setter: React.Dispatch<React.SetStateAction<Msg[]>>,
    setPlaying: React.Dispatch<React.SetStateAction<boolean>>,
    startDelay: number,
    onDone?: () => void,
  ) {
    setPlaying(true)
    let cumulative = startDelay
    msgs.forEach((msg, i) => {
      cumulative += msg.delay
      const t = setTimeout(() => {
        setter(prev => [...prev, msg])
        if (i === msgs.length - 1) {
          setPlaying(false)
          onDone?.()
        }
      }, cumulative)
      timers.current.push(t)
    })
  }

  function animateSlider(fromSession: number, toSession: number, duration: number) {
    const steps = 60
    const stepMs = duration / steps
    const range = toSession - fromSession
    for (let i = 0; i <= steps; i++) {
      const t = setTimeout(() => {
        setSliderSession(Math.round(fromSession + range * (i / steps)))
      }, i * stepMs)
      timers.current.push(t)
    }
  }

  function run() {
    // Session 1 starts from beginning
    scheduleSession(SESSION1, setSession1Msgs, setSession1Playing, 400)

    // Session 50 starts a bit later (staggered)
    scheduleSession(SESSION50, setSession50Msgs, setSession50Playing, 1800, () => {
      // After session 50 completes, animate slider from 1 to 50
      animateSlider(1, 50, 3000)
    })

    // Calculate total duration
    const s1Duration = SESSION1.reduce((s, m) => s + m.delay, 0) + 400
    const s50Duration = SESSION50.reduce((s, m) => s + m.delay, 0) + 1800
    const totalDuration = Math.max(s1Duration, s50Duration) + 3000 + 2500

    const t = setTimeout(() => {
      clearAll()
      setSession1Msgs([])
      setSession50Msgs([])
      setSession1Playing(false)
      setSession50Playing(false)
      setSliderSession(1)
      const t2 = setTimeout(run, 500)
      timers.current.push(t2)
    }, totalDuration + RESET_PAUSE)
    timers.current.push(t)
  }

  useEffect(() => {
    const t = setTimeout(run, 400)
    timers.current.push(t)
    return clearAll
  }, [])

  const s1Stats = {
    questions: session1Msgs.filter(m => m.kind === 'breaking').length,
    llmCalls:  session1Msgs.filter(m => m.kind === 'llm-handoff').length,
    msgCount:  session1Msgs.length,
  }
  const s50Stats = {
    questions: session50Msgs.filter(m => m.kind === 'breaking').length,
    llmCalls:  session50Msgs.filter(m => m.kind === 'llm-handoff').length,
    msgCount:  session50Msgs.length,
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: '14px 20px', gap: '10px' }}>

      {/* Header */}
      <div style={{ flexShrink: 0 }}>
        <span style={{ fontSize: '13px', fontWeight: 600, color: '#0f172a' }}>
          Same query — session 1 vs session 50
        </span>
        <span style={{ fontSize: '12px', color: '#94a3b8', marginLeft: '10px' }}>
          49 confirmations reduce 3 breaking questions to 0
        </span>
      </div>

      {/* Two session panels */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: '14px' }}>
        <SessionPanel
          title="Session 1 — cold graph"
          accentColor="#7c3aed"
          messages={session1Msgs}
          isPlaying={session1Playing}
          stats={s1Stats}
        />

        {/* Divider */}
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: '6px', flexShrink: 0,
        }}>
          <div style={{ flex: 1, width: '1px', background: '#e2e8f0' }} />
          <span style={{ fontSize: '10px', fontWeight: 700, color: '#94a3b8', letterSpacing: '0.06em' }}>
            50<br />SESSIONS
          </span>
          <div style={{ flex: 1, width: '1px', background: '#e2e8f0' }} />
        </div>

        <SessionPanel
          title="Session 50 — warm graph"
          accentColor="#16a34a"
          messages={session50Msgs}
          isPlaying={session50Playing}
          stats={s50Stats}
        />
      </div>

      {/* Slider learning curve */}
      <LearningCurve session={sliderSession} onSessionChange={setSliderSession} />
    </div>
  )
}

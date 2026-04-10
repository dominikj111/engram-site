import { useState, useEffect, useRef, useCallback } from 'react'

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

function countConversationMsgs(msgs: Msg[]): number {
  return msgs.filter(m => m.kind === 'user' || m.kind === 'bot' || m.kind === 'breaking').length
}

function SessionPanel({
  title,
  accentColor,
  messages,
  isPlaying,
  stats,
  disabled,
}: {
  title: string
  accentColor: string
  messages: Msg[]
  isPlaying: boolean
  stats: { questions: number; llmCalls: number; msgCount: number }
  disabled?: boolean
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length])

  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0,
    }}>
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
        opacity: disabled ? 0.3 : 1,
        transition: 'opacity 0.6s ease',
        pointerEvents: disabled ? 'none' : undefined,
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

// ── Live stats panel — driven by actual displayed messages ────────────────────

function lerp(a: number, b: number, t: number) { return a + (b - a) * t }

function LiveStats({
  session1Msgs,
  session50Msgs,
  counting,
}: {
  session1Msgs: Msg[]
  session50Msgs: Msg[]
  counting?: boolean
}) {
  // Animate a 0→1 progress during counting phase
  const [progress, setProgress] = useState(0)
  const [countingDone, setCountingDone] = useState(false)
  const frameRef = useRef(0)
  const startRef = useRef(0)
  const COUNTING_DURATION = 5000

  useEffect(() => {
    if (!counting) {
      cancelAnimationFrame(frameRef.current)
      // Don't reset progress — keep final value stable
      return
    }
    setCountingDone(false)
    setProgress(0)
    startRef.current = performance.now()
    function tick() {
      const elapsed = performance.now() - startRef.current
      const t = Math.min(1, elapsed / COUNTING_DURATION)
      setProgress(t)
      if (t < 1) {
        frameRef.current = requestAnimationFrame(tick)
      } else {
        setCountingDone(true)
      }
    }
    frameRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frameRef.current)
  }, [counting])

  // Session 1 final stats (cold graph baseline)
  const s1Processing = session1Msgs.filter(m => m.kind === 'processing')
  const s1Conf = s1Processing.length > 0 ? (s1Processing[s1Processing.length - 1].confidence ?? 0) : 0
  const s1Questions = session1Msgs.filter(m => m.kind === 'breaking').length
  const s1LlmCalls = session1Msgs.filter(m => m.kind === 'llm-handoff').length
  const s1MsgCount = countConversationMsgs(session1Msgs)
  const s1ResponseTime = session1Msgs.reduce((sum, m) => sum + m.delay, 0)

  // Session 50 targets (warm graph)
  const S50_CONF = 0.91
  const S50_QUESTIONS = 0
  const S50_MSG_COUNT = 3
  const S50_RESPONSE_TIME = 85

  // Determine displayed values
  let sessionNum: number
  let conf: number
  let questions: number
  let llmCalls: number
  let msgCount: number
  let responseTime: number
  let questionsSaved: number
  let llmSaved: number
  let confDelta: string
  let speedup: string

  if (counting) {
    // Interpolating from Session 1 → Session 50
    const t = progress
    sessionNum = Math.round(lerp(1, 25, t))
    conf = lerp(s1Conf, S50_CONF, Math.pow(t, 0.5))
    questions = Math.max(0, Math.round(lerp(s1Questions, S50_QUESTIONS, Math.min(1, t * 2))))
    llmCalls = t > 0.15 ? 0 : s1LlmCalls
    msgCount = Math.max(S50_MSG_COUNT, Math.round(lerp(s1MsgCount, S50_MSG_COUNT, Math.pow(t, 0.6))))
    responseTime = Math.round(lerp(s1ResponseTime, S50_RESPONSE_TIME, Math.pow(t, 0.7)))
    questionsSaved = s1Questions - questions
    llmSaved = s1LlmCalls - llmCalls
    confDelta = `+${(conf - s1Conf).toFixed(2)}`
    speedup = responseTime > 0 ? `${(s1ResponseTime / responseTime).toFixed(0)}x` : '—'
  } else if (countingDone || session50Msgs.length > 0) {
    // Counting finished or Session 50 is playing — show final improvements
    sessionNum = 25
    const s50Processing = session50Msgs.filter(m => m.kind === 'processing')
    conf = s50Processing.length > 0 ? (s50Processing[s50Processing.length - 1].confidence ?? S50_CONF) : S50_CONF
    questions = session50Msgs.filter(m => m.kind === 'breaking').length
    llmCalls = session50Msgs.filter(m => m.kind === 'llm-handoff').length
    msgCount = countConversationMsgs(session50Msgs)
    responseTime = session50Msgs.length >= 2 ? 85 : 0
    questionsSaved = s1Questions - questions
    llmSaved = s1LlmCalls - llmCalls
    confDelta = `+${(conf - s1Conf).toFixed(2)}`
    speedup = responseTime > 0 ? `${Math.round(s1ResponseTime / responseTime)}x` : '—'
  } else {
    // Session 1 is playing — show accumulating cold graph values
    sessionNum = 1
    const processingMsgs = session1Msgs.filter(m => m.kind === 'processing')
    conf = processingMsgs.length > 0 ? (processingMsgs[processingMsgs.length - 1].confidence ?? 0) : 0
    questions = session1Msgs.filter(m => m.kind === 'breaking').length
    llmCalls = session1Msgs.filter(m => m.kind === 'llm-handoff').length
    msgCount = countConversationMsgs(session1Msgs)
    responseTime = session1Msgs.reduce((sum, m) => sum + m.delay, 0)
    questionsSaved = 0
    llmSaved = 0
    confDelta = '—'
    speedup = '—'
  }

  const isWarm = sessionNum >= 35
  const accentColor = isWarm ? '#16a34a' : '#7c3aed'

  return (
    <div style={{
      flexShrink: 0,
      background: '#fff', border: '1px solid #e2e8f0', borderRadius: '10px',
      padding: '12px 16px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
        <span style={{ fontSize: '12px', fontWeight: 600, color: '#0f172a' }}>
          Session {sessionNum} — live stats
        </span>
        <span style={{
          fontSize: '10px', fontWeight: 600,
          color: accentColor,
          background: isWarm ? '#f0fdf4' : '#faf5ff',
          border: `1px solid ${isWarm ? '#bbf7d0' : '#ddd6fe'}`,
          borderRadius: '4px', padding: '1px 6px',
          transition: 'all 0.3s ease',
        }}>
          {counting ? 'WARMING' : isWarm ? 'WARM GRAPH' : 'COLD GRAPH'}
        </span>
      </div>

      <div style={{ display: 'flex', gap: '0', overflow: 'hidden', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
        {[
          { label: 'Confidence', value: conf > 0 ? conf.toFixed(2) : '—', color: conf > 0.75 ? '#16a34a' : conf > 0.4 ? '#2563eb' : '#7c3aed' },
          { label: 'Confidence Δ', value: confDelta, color: confDelta !== '—' ? '#16a34a' : '#94a3b8' },
          { label: 'Questions saved', value: String(questionsSaved), color: questionsSaved > 0 ? '#16a34a' : '#94a3b8' },
          { label: 'LLM calls saved', value: String(llmSaved), color: llmSaved > 0 ? '#16a34a' : '#94a3b8' },
          { label: 'Messages', value: String(msgCount), color: '#64748b' },
          { label: 'Response time', value: responseTime === 0 ? '—' : responseTime < 1000 ? `${responseTime}ms` : `${(responseTime / 1000).toFixed(1)}s`, color: responseTime > 0 && responseTime < 200 ? '#16a34a' : responseTime < 2000 ? '#2563eb' : '#7c3aed' },
          { label: 'Speedup', value: speedup, color: speedup !== '—' && speedup !== '1x' ? '#16a34a' : '#94a3b8' },
        ].map((stat, i, arr) => (
          <div key={stat.label} style={{
            flex: 1, padding: '8px 10px', textAlign: 'center',
            borderRight: i < arr.length - 1 ? '1px solid #e2e8f0' : undefined,
          }}>
            <div style={{ fontSize: '16px', fontWeight: 700, color: stat.color, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
              {stat.value}
            </div>
            <div style={{ fontSize: '9px', color: '#94a3b8', marginTop: '3px' }}>{stat.label}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

type Phase = 'session1' | 'stats' | 'session50' | 'done'

export default function GraphLearns({ paused }: { paused?: boolean }) {
  const [session1Msgs, setSession1Msgs] = useState<Msg[]>([])
  const [session50Msgs, setSession50Msgs] = useState<Msg[]>([])
  const [session1Playing, setSession1Playing] = useState(false)
  const [session50Playing, setSession50Playing] = useState(false)
  const [phase, setPhase] = useState<Phase>('session1')
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const pausedRef = useRef(paused)

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
      sched(cumulative, () => {
        setter(prev => [...prev, msg])
        if (i === msgs.length - 1) {
          setPlaying(false)
          onDone?.()
        }
      })
    })
  }

  function run() {
    // Phase 1: Session 1 plays (cold graph)
    scheduleSession(SESSION1, setSession1Msgs, setSession1Playing, 400, () => {
      // Phase 2: Session 1 done → enable live stats, disable both panels
      sched(400, () => setPhase('stats'))
    })

    // After Session 1 finishes + stats transition time, start Session 50
    const s1Duration = SESSION1.reduce((s, m) => s + m.delay, 0) + 400
    const statsPhaseStart = s1Duration + 400

    // Phase 3: After stats counting finishes (5s animation + buffer), start Session 50
    const s50StartTime = statsPhaseStart + 5500
    sched(s50StartTime, () => setPhase('session50'))
    scheduleSession(SESSION50, setSession50Msgs, setSession50Playing, s50StartTime, () => {
      // Phase 4: Session 50 done → leave session 50 clear, disable rest
      sched(600, () => setPhase('done'))
    })
  }

  useEffect(() => {
    sched(400, run)
    return clearAll
  }, [])

  const s1Stats = {
    questions: session1Msgs.filter(m => m.kind === 'breaking').length,
    llmCalls:  session1Msgs.filter(m => m.kind === 'llm-handoff').length,
    msgCount:  countConversationMsgs(session1Msgs),
  }
  const s50Stats = {
    questions: session50Msgs.filter(m => m.kind === 'breaking').length,
    llmCalls:  session50Msgs.filter(m => m.kind === 'llm-handoff').length,
    msgCount:  countConversationMsgs(session50Msgs),
  }

  // Phase-based disabled states — only chat windows fade, not titles/pills
  const s1Disabled  = phase !== 'session1'
  const s50Disabled = phase === 'session1' || phase === 'stats'

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
          disabled={s1Disabled}
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
          disabled={s50Disabled}
        />
      </div>

      {/* Live stats — always visible, shows cumulative improvements */}
      <LiveStats session1Msgs={session1Msgs} session50Msgs={session50Msgs} counting={phase === 'stats'} />
    </div>
  )
}

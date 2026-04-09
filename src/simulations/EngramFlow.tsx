import { useState, useEffect, useRef } from 'react'

// ── Types ────────────────────────────────────────────────────────────────────

type MsgKind =
  | 'user'
  | 'processing'
  | 'bot'
  | 'action'
  | 'action-confirm'
  | 'revert'
  | 'breaking'
  | 'feedback'
  | 'feedback-no'
  | 'negative'
  | 'llm-handoff'
  | 'learning'
  | 'session-end'

interface Msg {
  kind: MsgKind
  text: string
  delay: number
  sub?: string
  outcome?: 'hit' | 'question' | 'llm'
}

// ── Message segments ──────────────────────────────────────────────────────────

const initialMsgs: Msg[] = [
  { kind: 'user',       text: 'connection keeps timing out',                                                             delay: 500  },
  { kind: 'processing', text: 'timeout · connection_pool · database_config', sub: 'confidence 0.91', outcome: 'hit',     delay: 800  },
  { kind: 'bot',        text: 'Your connection pool is undersized for this load. Minimum recommended: 20 connections.',  delay: 600  },
  { kind: 'action',     text: 'scale_pool(min=20)', sub: 'Revertable action triggered',                                  delay: 500  },
  { kind: 'feedback',   text: 'Did this solve it?',                                                                      delay: 700  },
]

const yes1Msgs: Msg[] = [
  { kind: 'learning',   text: 'timeout → connection_pool → scale_pool', sub: 'weight 0.91 → 0.93  ·  path reinforced',  delay: 400  },
]

const no1Msgs: Msg[] = [
  { kind: 'feedback-no', text: 'No, still timing out',                                                                   delay: 0    },
  { kind: 'revert',      text: 'scale_pool(min=20) → rolled back',      sub: 'Action reverted',                         delay: 400  },
  { kind: 'negative',    text: 'timeout → connection_pool → scale_pool', sub: 'weight 0.91 → 0.76  ·  weak memory recorded', delay: 500 },
  { kind: 'processing',  text: 'timeout → db_config · network · firewall', sub: 'confidence 0.55', outcome: 'question', delay: 700  },
  { kind: 'breaking',    text: 'Are the timeouts happening on all queries or only when hitting a specific table?',        delay: 600  },
  { kind: 'user',        text: 'only on the orders table',                                                                delay: 1000 },
  { kind: 'processing',  text: 'timeout → db_config → missing_index', sub: 'confidence 0.82', outcome: 'hit',           delay: 700  },
  { kind: 'bot',         text: 'Missing index on orders.customer_id — full table scan on every query. Add a covering index.', delay: 600 },
  { kind: 'feedback',    text: 'Did this solve it?',                                                                     delay: 700  },
]

const yes2Msgs: Msg[] = [
  { kind: 'learning',    text: 'timeout → db_config → missing_index', sub: 'weight 0.82 → 0.86  ·  path reinforced',   delay: 400  },
]

const no2Msgs: Msg[] = [
  { kind: 'feedback-no', text: 'No, timeouts still happening',                                                            delay: 0    },
  { kind: 'negative',    text: 'timeout → db_config → missing_index', sub: 'weight 0.82 → 0.67  ·  weak memory recorded', delay: 500  },
  { kind: 'llm-handoff', text: '{ path: ["timeout","db_config"], ruled_out: ["connection_pool","missing_index"], attempts: 2, confidence: 0.21 }', sub: 'Structured handoff → LLM / operator', delay: 700 },
  { kind: 'bot',         text: 'Two paths ruled out. Likely lock contention — a long-running transaction may be blocking the orders table.', delay: 900 },
  { kind: 'action',      text: 'kill_blocking_transaction(table=orders)', sub: 'Revertable action triggered',             delay: 500  },
  { kind: 'feedback',    text: 'Did this solve it?',                                                                      delay: 700  },
]

const yes3Msgs: Msg[] = [
  { kind: 'learning',    text: 'timeout → lock_contention → kill_blocking_transaction', sub: 'New path confirmed  ·  weight 0.50 → 0.55  ·  failed paths not propagated', delay: 400 },
]

const no3Msgs: Msg[] = [
  { kind: 'feedback-no', text: 'No, still timing out',                                                                   delay: 0    },
  { kind: 'revert',      text: 'kill_blocking_transaction → rolled back', sub: 'Action reverted',                        delay: 400  },
  { kind: 'negative',    text: 'timeout → lock_contention', sub: 'weight 0.50 → 0.41  ·  weak memory recorded',          delay: 500  },
  { kind: 'llm-handoff', text: '{ ruled_out: ["connection_pool","missing_index","lock_contention"], attempts: 3, confidence: 0.08 }', sub: 'LLM loop — attempt 3', delay: 700 },
  { kind: 'bot',         text: 'All common paths exhausted. Could be a misconfigured query timeout at the application layer — check your ORM or database driver timeout settings.', delay: 900 },
  { kind: 'action',      text: 'set_query_timeout(driver=orm, value=30s)', sub: 'Revertable action triggered',            delay: 500  },
  { kind: 'feedback',    text: 'Did this solve it?',                                                                      delay: 700  },
]

const yes4Msgs: Msg[] = [
  { kind: 'learning',    text: 'timeout → orm_config → set_query_timeout', sub: 'New path confirmed  ·  weight 0.50 → 0.55  ·  failed paths not propagated', delay: 400 },
]

const no4Msgs: Msg[] = [
  { kind: 'feedback-no', text: 'No, still timing out',                                                                   delay: 0    },
  { kind: 'revert',      text: 'set_query_timeout → rolled back', sub: 'Action reverted',                                delay: 400  },
  { kind: 'negative',    text: 'timeout → orm_config', sub: 'weight 0.50 → 0.41  ·  weak memory recorded',              delay: 500  },
  { kind: 'llm-handoff', text: '{ attempts: 4, confidence: 0.04, escalate: "human_operator" }', sub: 'Escalated to human operator — all automated paths exhausted', delay: 700 },
  { kind: 'bot',         text: 'Handing off to a human operator with full context. All attempted paths and ruled-out candidates are included in the handoff.', delay: 900 },
]

// ── State machine ─────────────────────────────────────────────────────────────

type FlowState =
  | { phase: 'playing-initial' }
  | { phase: 'await-1' }
  | { phase: 'playing-yes1' }
  | { phase: 'playing-no1' }
  | { phase: 'await-2' }
  | { phase: 'playing-yes2' }
  | { phase: 'playing-no2' }
  | { phase: 'await-3' }
  | { phase: 'playing-yes3' }
  | { phase: 'playing-no3' }
  | { phase: 'await-4' }
  | { phase: 'playing-yes4' }
  | { phase: 'playing-no4' }
  | { phase: 'waiting-operator' }
  | { phase: 'done' }

// ── Small components ──────────────────────────────────────────────────────────

function ConfidenceBar({ value, outcome }: { value: number; outcome?: Msg['outcome'] }) {
  const color = outcome === 'hit' ? '#16a34a' : outcome === 'question' ? '#2563eb' : '#7c3aed'
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', marginLeft: '8px' }}>
      <span style={{
        display: 'inline-block', borderRadius: '9999px',
        width: `${Math.round(value * 48)}px`, height: '5px',
        background: color, opacity: 0.85, minWidth: '4px',
      }} />
      <span style={{ color, fontSize: '10px', fontWeight: 700 }}>{value.toFixed(2)}</span>
    </span>
  )
}

function OutcomeBadge({ outcome }: { outcome?: Msg['outcome'] }) {
  if (outcome === 'hit')      return <InlineBadge color="#16a34a" bg="#f0fdf4" label="✓ hit" />
  if (outcome === 'question') return <InlineBadge color="#2563eb" bg="#eff6ff" label="? question" />
  if (outcome === 'llm')      return <InlineBadge color="#7c3aed" bg="#f5f3ff" label="→ LLM" />
  return null
}

function InlineBadge({ color, bg, label }: { color: string; bg: string; label: string }) {
  return (
    <span style={{
      display: 'inline-block', borderRadius: '9999px', padding: '2px 8px',
      fontSize: '11px', fontWeight: 600, marginLeft: '6px',
      color, background: bg, border: `1px solid ${color}30`,
    }}>
      {label}
    </span>
  )
}

function Avatar({ letter, color, bg, border }: { letter: string; color: string; bg: string; border: string }) {
  return (
    <div style={{
      flexShrink: 0, width: '28px', height: '28px', borderRadius: '50%',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: '11px', fontWeight: 700, marginTop: '2px',
      background: bg, color, border: `1px solid ${border}`,
    }}>
      {letter}
    </div>
  )
}

// ── Bubble ────────────────────────────────────────────────────────────────────

function Bubble({
  msg,
  feedbackDisabled,
  onYes,
  onNo,
}: {
  msg: Msg
  feedbackDisabled?: boolean
  onYes?: () => void
  onNo?: () => void
}) {
  if (msg.kind === 'user') return (
    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
      <div style={{
        borderRadius: '16px 4px 16px 16px', padding: '10px 16px',
        fontSize: '13px', maxWidth: '280px',
        background: '#1e293b', color: '#f1f5f9',
      }}>{msg.text}</div>
    </div>
  )

  if (msg.kind === 'processing') {
    const conf = msg.sub ? parseFloat(msg.sub.replace('confidence ', '')) : NaN
    return (
      <div style={{
        display: 'flex', alignItems: 'flex-start', gap: '8px',
        padding: '6px 12px', borderRadius: '8px', fontSize: '11px',
        background: '#f8fafc', border: '1px solid #e2e8f0',
      }}>
        <span style={{ color: '#94a3b8', fontFamily: 'ui-monospace, monospace', marginTop: '1px' }}>⟳</span>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px' }}>
          <span style={{ color: '#64748b', fontFamily: 'ui-monospace, monospace' }}>{msg.text}</span>
          {!isNaN(conf) && <ConfidenceBar value={conf} outcome={msg.outcome} />}
          <OutcomeBadge outcome={msg.outcome} />
        </div>
      </div>
    )
  }

  if (msg.kind === 'bot') return (
    <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', maxWidth: '380px' }}>
        <Avatar letter="E" color="#64748b" bg="#f1f5f9" border="#e2e8f0" />
        <div style={{
          borderRadius: '16px 16px 16px 4px', padding: '10px 16px',
          fontSize: '13px', background: '#fff', border: '1px solid #e2e8f0', color: '#1e293b',
        }}>{msg.text}</div>
      </div>
    </div>
  )

  if (msg.kind === 'breaking') return (
    <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', maxWidth: '380px' }}>
        <Avatar letter="E" color="#2563eb" bg="#eff6ff" border="#bfdbfe" />
        <div style={{
          borderRadius: '16px 16px 16px 4px', padding: '10px 16px',
          fontSize: '13px', background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1e40af',
        }}>{msg.text}</div>
      </div>
    </div>
  )

  if (msg.kind === 'action') return (
    <div style={{ display: 'flex', justifyContent: 'flex-start', marginLeft: '36px' }}>
      <div style={{
        display: 'flex', alignItems: 'flex-start', gap: '8px',
        borderRadius: '8px', padding: '8px 12px',
        fontSize: '11px', fontFamily: 'ui-monospace, monospace',
        background: '#fefce8', border: '1px solid #fde047', color: '#854d0e',
      }}>
        <span style={{ color: '#ca8a04', fontSize: '13px', marginTop: '1px' }}>⚡</span>
        <div>
          <div style={{ fontWeight: 600, marginBottom: '2px', color: '#78350f', fontSize: '9px', letterSpacing: '0.05em' }}>
            {msg.sub?.toUpperCase()}
          </div>
          <div>{msg.text}</div>
        </div>
      </div>
    </div>
  )

  if (msg.kind === 'action-confirm') return (
    <div style={{ display: 'flex', justifyContent: 'flex-start', marginLeft: '36px' }}>
      <div style={{
        display: 'flex', alignItems: 'flex-start', gap: '8px',
        borderRadius: '8px', padding: '8px 12px',
        fontSize: '11px', fontFamily: 'ui-monospace, monospace',
        background: '#fff7ed', border: '1.5px solid #f97316', color: '#9a3412',
      }}>
        <span style={{ color: '#ea580c', fontSize: '13px', marginTop: '1px' }}>⚠️</span>
        <div>
          <div style={{ fontWeight: 600, marginBottom: '2px', color: '#7c2d12', fontSize: '9px', letterSpacing: '0.05em' }}>
            CONFIRMATION REQUIRED · NON-REVERTABLE
          </div>
          <div>{msg.text}</div>
        </div>
      </div>
    </div>
  )

  if (msg.kind === 'revert') return (
    <div style={{ display: 'flex', justifyContent: 'flex-start', marginLeft: '36px' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: '8px',
        borderRadius: '8px', padding: '8px 12px',
        fontSize: '11px', fontFamily: 'ui-monospace, monospace',
        background: '#f0f9ff', border: '1px solid #bae6fd', color: '#0369a1',
      }}>
        <span style={{ fontSize: '12px' }}>↩</span>
        <div>
          <div style={{ fontWeight: 600, marginBottom: '2px', fontSize: '9px', letterSpacing: '0.05em', color: '#0c4a6e' }}>
            {msg.sub?.toUpperCase()}
          </div>
          <div>{msg.text}</div>
        </div>
      </div>
    </div>
  )

  if (msg.kind === 'negative') return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '8px',
      fontSize: '11px', padding: '6px 12px', borderRadius: '8px',
      background: '#fff7ed', border: '1px solid #fed7aa', color: '#9a3412',
    }}>
      <span>↓</span>
      <div>
        <span style={{ fontWeight: 600, fontFamily: 'ui-monospace, monospace' }}>{msg.text}</span>
        <span style={{ marginLeft: '8px', color: '#c2410c', opacity: 0.8 }}>{msg.sub}</span>
      </div>
    </div>
  )

  if (msg.kind === 'learning') return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '8px',
      fontSize: '11px', padding: '6px 12px', borderRadius: '8px',
      background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#15803d',
    }}>
      <span>↑</span>
      <div>
        <span style={{ fontWeight: 600, fontFamily: 'ui-monospace, monospace' }}>{msg.text}</span>
        <span style={{ marginLeft: '8px', color: '#16a34a', opacity: 0.7 }}>{msg.sub}</span>
      </div>
    </div>
  )

  if (msg.kind === 'llm-handoff') return (
    <div style={{ display: 'flex', justifyContent: 'flex-start', marginLeft: '36px' }}>
      <div style={{
        borderRadius: '8px', padding: '8px 12px', fontSize: '11px', maxWidth: '320px',
        background: '#faf5ff', border: '1px solid #ddd6fe', color: '#6d28d9',
      }}>
        <div style={{ fontWeight: 600, marginBottom: '4px', color: '#7c3aed', fontSize: '9px', letterSpacing: '0.05em' }}>
          {msg.sub?.toUpperCase()}
        </div>
        <div style={{ fontFamily: 'ui-monospace, monospace', color: '#5b21b6', fontSize: '10px', wordBreak: 'break-word' }}>
          {msg.text}
        </div>
      </div>
    </div>
  )

  if (msg.kind === 'feedback') return (
    <div style={{ display: 'flex', justifyContent: 'flex-start', marginLeft: '36px' }}>
      <div style={{ borderRadius: '12px', padding: '12px 16px', background: '#f8fafc', border: '1px solid #e2e8f0' }}>
        <div style={{ fontSize: '12px', fontWeight: 500, color: '#64748b', marginBottom: '10px' }}>{msg.text}</div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={!feedbackDisabled ? onYes : undefined}
            disabled={feedbackDisabled}
            style={{
              padding: '6px 14px', borderRadius: '8px', fontSize: '12px', fontWeight: 600,
              fontFamily: 'inherit', cursor: feedbackDisabled ? 'default' : 'pointer',
              background: '#f0fdf4', border: '1.5px solid #bbf7d0', color: '#15803d',
              opacity: feedbackDisabled ? 0.35 : 1,
            }}
          >✓ Yes, solved</button>
          <button
            onClick={!feedbackDisabled ? onNo : undefined}
            disabled={feedbackDisabled}
            style={{
              padding: '6px 14px', borderRadius: '8px', fontSize: '12px', fontWeight: 600,
              fontFamily: 'inherit', cursor: feedbackDisabled ? 'default' : 'pointer',
              background: '#fff7ed', border: '1.5px solid #fed7aa', color: '#9a3412',
              opacity: feedbackDisabled ? 0.35 : 1,
            }}
          >✗ No, still failing</button>
        </div>
      </div>
    </div>
  )

  if (msg.kind === 'feedback-no') return (
    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
      <div style={{
        borderRadius: '16px 4px 16px 16px', padding: '10px 16px',
        fontSize: '13px', background: '#7f1d1d', color: '#fecaca',
      }}>{msg.text}</div>
    </div>
  )

  if (msg.kind === 'session-end') return (
    <div style={{
      borderRadius: '12px', padding: '12px 16px', fontSize: '11px', textAlign: 'center',
      background: '#f8fafc', border: '1px dashed #cbd5e1', color: '#64748b',
    }}>
      <div style={{ fontWeight: 600, marginBottom: '4px', color: '#475569' }}>Session closed</div>
      <div style={{ lineHeight: '1.5' }}>{msg.text}</div>
    </div>
  )

  return null
}

// ── Legend items ───────────────────────────────────────────────────────────────

const LEGEND = [
  { color: '#16a34a', label: '✓ Knowledge hit', desc: 'no LLM cost' },
  { color: '#2563eb', label: '? Breaking question', desc: 'reduces ambiguity' },
  { color: '#7c3aed', label: '→ LLM fallback', desc: 'structured handoff' },
  { color: '#ca8a04', label: '⚡ Revertable action', desc: 'can be undone' },
  { color: '#0369a1', label: '↩ Action reverted', desc: 'rolled back' },
  { color: '#c2410c', label: '↓ Path weakens', desc: 'negative signal' },
  { color: '#15803d', label: '↑ Graph learns', desc: 'cheaper next time' },
]

// ── Main ──────────────────────────────────────────────────────────────────────

export default function EngramFlow({ paused }: { paused?: boolean }) {
  const [flowState, setFlowState]  = useState<FlowState>({ phase: 'playing-initial' })
  const [messages, setMessages]    = useState<Msg[]>([])
  const [visibleCount, setVisible] = useState(0)
  const timers    = useRef<ReturnType<typeof setTimeout>[]>([])
  const bottomRef = useRef<HTMLDivElement>(null)
  const pausedRef = useRef(paused)
  const instanceRef = useRef(0)

  useEffect(() => { pausedRef.current = paused }, [paused])

  function clearTimers() { timers.current.forEach(clearTimeout); timers.current = [] }

  function sched(delay: number, fn: () => void) {
    if (pausedRef.current) {
      const poll = setInterval(() => {
        if (!pausedRef.current) { clearInterval(poll); sched(delay, fn) }
      }, 100)
      timers.current.push(poll as unknown as ReturnType<typeof setTimeout>)
      return
    }
    const t = setTimeout(fn, delay)
    timers.current.push(t)
  }

  function scheduleSegment(segment: Msg[], onDone?: () => void) {
    clearTimers()
    setMessages(prev => [...prev, ...segment])
    setVisible(prev => {
      const base = prev
      let cumulative = 0
      segment.forEach((msg, i) => {
        cumulative += msg.delay
        const d = cumulative
        sched(d, () => setVisible(base + i + 1))
      })
      if (onDone) {
        const total = segment.reduce((s, m) => s + m.delay, 0)
        sched(total + 50, onDone)
      }
      return prev
    })
  }

  useEffect(() => {
    instanceRef.current++
    setMessages(initialMsgs)
    let cumulative = 300
    initialMsgs.forEach((_, i) => {
      cumulative += initialMsgs[i].delay
      sched(cumulative, () => setVisible(i + 1))
    })
    const total = initialMsgs.reduce((s, m) => s + m.delay, 300)
    sched(total + 50, () => setFlowState({ phase: 'await-1' }))
    return clearTimers
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Removed aggressive scrollIntoView — messages render naturally without forcing page scroll

  function handleYes1() { setFlowState({ phase: 'playing-yes1' }); scheduleSegment(yes1Msgs, () => setFlowState({ phase: 'done' })) }
  function handleNo1()  { setFlowState({ phase: 'playing-no1' });  scheduleSegment(no1Msgs,  () => setFlowState({ phase: 'await-2' })) }
  function handleYes2() { setFlowState({ phase: 'playing-yes2' }); scheduleSegment(yes2Msgs, () => setFlowState({ phase: 'done' })) }
  function handleNo2()  { setFlowState({ phase: 'playing-no2' });  scheduleSegment(no2Msgs,  () => setFlowState({ phase: 'await-3' })) }
  function handleYes3() { setFlowState({ phase: 'playing-yes3' }); scheduleSegment(yes3Msgs, () => setFlowState({ phase: 'done' })) }
  function handleNo3()  { setFlowState({ phase: 'playing-no3' });  scheduleSegment(no3Msgs,  () => setFlowState({ phase: 'await-4' })) }
  function handleYes4() { setFlowState({ phase: 'playing-yes4' }); scheduleSegment(yes4Msgs, () => setFlowState({ phase: 'done' })) }
  function handleNo4()  { setFlowState({ phase: 'playing-no4' });  scheduleSegment(no4Msgs,  () => setFlowState({ phase: 'waiting-operator' })) }

  const phase = flowState.phase
  const visible = messages.slice(0, visibleCount)
  const isPlaying = phase.startsWith('playing-') || phase === 'waiting-operator'

  const feedbackIndices = visible.reduce<number[]>((acc, m, i) => m.kind === 'feedback' ? [...acc, i] : acc, [])
  const [fb1, fb2, fb3, fb4] = [feedbackIndices[0] ?? -1, feedbackIndices[1] ?? -1, feedbackIndices[2] ?? -1, feedbackIndices[3] ?? -1]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif' }}>

      {/* ── Compact horizontal legend ── */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: '10px 18px',
        padding: '10px 16px', borderBottom: '1px solid #e2e8f0', background: '#f8fafc',
        flexShrink: 0,
      }}>
        <span style={{ fontSize: '10px', fontWeight: 700, color: '#94a3b8', letterSpacing: '0.07em', textTransform: 'uppercase', marginRight: '4px', alignSelf: 'center' }}>
          Legend
        </span>
        {LEGEND.map(item => (
          <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: item.color, flexShrink: 0 }} />
            <span style={{ fontSize: '11px', fontWeight: 500, color: '#334155' }}>{item.label}</span>
            <span style={{ fontSize: '10px', color: '#94a3b8' }}>{item.desc}</span>
          </div>
        ))}
      </div>

      {/* ── Chat area ── */}
      <div style={{
        flex: 1, minHeight: 0, overflowY: 'auto',
        display: 'flex', flexDirection: 'column', gap: '10px',
        padding: '20px 24px',
      }}>
        {visible.length === 0 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1 }}>
            <span style={{ fontSize: '12px', color: '#cbd5e1' }}>Starting…</span>
          </div>
        )}

        {visible.map((msg, i) => {
          const isF1 = msg.kind === 'feedback' && i === fb1
          const isF2 = msg.kind === 'feedback' && i === fb2
          const isF3 = msg.kind === 'feedback' && i === fb3
          const isF4 = msg.kind === 'feedback' && i === fb4
          return (
            <div key={i} style={{ animation: 'efFadeIn 0.25s ease both' }}>
              <Bubble
                msg={msg}
                feedbackDisabled={
                  isF1 ? phase !== 'await-1' :
                  isF2 ? phase !== 'await-2' :
                  isF3 ? phase !== 'await-3' :
                  isF4 ? phase !== 'await-4' : undefined
                }
                onYes={isF1 ? handleYes1 : isF2 ? handleYes2 : isF3 ? handleYes3 : isF4 ? handleYes4 : undefined}
                onNo ={isF1 ? handleNo1  : isF2 ? handleNo2  : isF3 ? handleNo3  : isF4 ? handleNo4  : undefined}
              />
            </div>
          )
        })}

        {isPlaying && (
          <div style={{ display: 'flex', gap: '4px', marginLeft: '36px' }}>
            {[0, 1, 2].map(i => (
              <div key={i} style={{
                width: '6px', height: '6px', borderRadius: '50%',
                background: '#cbd5e1', animation: `efPulse 1.2s ${i * 0.2}s ease-in-out infinite`,
              }} />
            ))}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <style>{`
        @keyframes efFadeIn {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes efPulse {
          0%, 100% { opacity: 0.3; transform: scale(0.8); }
          50%       { opacity: 1;   transform: scale(1.1); }
        }
      `}</style>
    </div>
  )
}

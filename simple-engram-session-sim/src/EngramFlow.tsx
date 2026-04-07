import { useState, useEffect, useRef } from 'react'

// ── Types ────────────────────────────────────────────────────────────────────

type MsgKind =
  | 'user'
  | 'processing'
  | 'bot'
  | 'action'          // revertable action — can be undone
  | 'action-confirm'  // non-revertable — required confirmation before firing
  | 'revert'          // action was rolled back
  | 'breaking'
  | 'feedback'        // yes/no prompt — pauses playback
  | 'feedback-no'
  | 'negative'
  | 'llm-handoff'
  | 'learning'
  | 'session-end'     // unresolved session closed

interface Msg {
  kind: MsgKind
  text: string
  delay: number
  sub?: string
  outcome?: 'hit' | 'question' | 'llm'
}

// ── Message segments ──────────────────────────────────────────────────────────
// The conversation is a single linear flow with two feedback branch points.
//
//  initialMsgs  →  feedback-1
//    yes1Msgs   →  done (positive reinforcement)
//    no1Msgs    →  feedback-2
//      yes2Msgs →  done
//      no2Msgs  →  LLM handoff

const initialMsgs: Msg[] = [
  { kind: 'user',       text: 'connection keeps timing out',                                                              delay: 500  },
  { kind: 'processing', text: 'timeout · connection_pool · database_config', sub: 'confidence 0.91', outcome: 'hit',      delay: 800  },
  { kind: 'bot',        text: 'Your connection pool is undersized for this load. Minimum recommended: 20 connections.',   delay: 600  },
  { kind: 'action',     text: 'scale_pool(min=20)', sub: 'Revertable action triggered',                                   delay: 500  },
  { kind: 'feedback',   text: 'Did this solve it?',                                                                       delay: 700  },
]

const yes1Msgs: Msg[] = [
  { kind: 'learning',   text: 'timeout → connection_pool → scale_pool', sub: 'weight 0.91 → 0.93  ·  path reinforced',   delay: 400  },
]

const no1Msgs: Msg[] = [
  { kind: 'feedback-no', text: 'No, still timing out',                                                                    delay: 0    },
  { kind: 'revert',      text: 'scale_pool(min=20) → rolled back',      sub: 'Action reverted',                          delay: 400  },
  { kind: 'negative',    text: 'timeout → connection_pool → scale_pool', sub: 'weight 0.91 → 0.76  ·  weak memory recorded', delay: 500 },
  { kind: 'processing',  text: 'timeout → db_config · network · firewall', sub: 'confidence 0.55', outcome: 'question',  delay: 700  },
  { kind: 'breaking',    text: 'Are the timeouts happening on all queries or only when hitting a specific table?',         delay: 600  },
  { kind: 'user',        text: 'only on the orders table',                                                                 delay: 1000 },
  { kind: 'processing',  text: 'timeout → db_config → missing_index', sub: 'confidence 0.82', outcome: 'hit',            delay: 700  },
  { kind: 'bot',         text: 'Missing index on orders.customer_id — full table scan on every query. Add a covering index.', delay: 600 },
  { kind: 'feedback',    text: 'Did this solve it?',                                                                      delay: 700  },
]

const yes2Msgs: Msg[] = [
  { kind: 'learning',    text: 'timeout → db_config → missing_index', sub: 'weight 0.82 → 0.86  ·  path reinforced',    delay: 400  },
]

const no2Msgs: Msg[] = [
  { kind: 'feedback-no', text: 'No, timeouts still happening',                                                             delay: 0    },
  { kind: 'negative',    text: 'timeout → db_config → missing_index', sub: 'weight 0.82 → 0.67  ·  weak memory recorded', delay: 500  },
  { kind: 'llm-handoff', text: '{ path: ["timeout","db_config"], ruled_out: ["connection_pool","missing_index"], attempts: 2, confidence: 0.21 }', sub: 'Structured handoff → LLM / operator', delay: 700 },
  { kind: 'bot',         text: 'Two paths ruled out. Likely lock contention — a long-running transaction may be blocking the orders table.', delay: 900 },
  { kind: 'action',      text: 'kill_blocking_transaction(table=orders)', sub: 'Revertable action triggered',              delay: 500  },
  { kind: 'feedback',    text: 'Did this solve it?',                                                                       delay: 700  },
]

const yes3Msgs: Msg[] = [
  { kind: 'learning',    text: 'timeout → lock_contention → kill_blocking_transaction', sub: 'New path confirmed  ·  weight 0.50 → 0.55  ·  failed paths not propagated', delay: 400 },
]

const no3Msgs: Msg[] = [
  { kind: 'feedback-no', text: 'No, still timing out',                                                                    delay: 0    },
  { kind: 'revert',      text: 'kill_blocking_transaction → rolled back', sub: 'Action reverted',                         delay: 400  },
  { kind: 'negative',    text: 'timeout → lock_contention', sub: 'weight 0.50 → 0.41  ·  weak memory recorded',           delay: 500  },
  { kind: 'llm-handoff', text: '{ ruled_out: ["connection_pool","missing_index","lock_contention"], attempts: 3, confidence: 0.08 }', sub: 'LLM loop — attempt 3', delay: 700 },
  { kind: 'bot',         text: 'All common paths exhausted. Could be a misconfigured query timeout at the application layer — check your ORM or database driver timeout settings.', delay: 900 },
  { kind: 'action',      text: 'set_query_timeout(driver=orm, value=30s)', sub: 'Revertable action triggered',             delay: 500  },
  { kind: 'feedback',    text: 'Did this solve it?',                                                                       delay: 700  },
]

const yes4Msgs: Msg[] = [
  { kind: 'learning',    text: 'timeout → orm_config → set_query_timeout', sub: 'New path confirmed  ·  weight 0.50 → 0.55  ·  failed paths not propagated', delay: 400 },
]

const no4Msgs: Msg[] = [
  { kind: 'feedback-no', text: 'No, still timing out',                                                                    delay: 0    },
  { kind: 'revert',      text: 'set_query_timeout → rolled back', sub: 'Action reverted',                                 delay: 400  },
  { kind: 'negative',    text: 'timeout → orm_config', sub: 'weight 0.50 → 0.41  ·  weak memory recorded',               delay: 500  },
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
  | { phase: 'waiting-operator' }  // human operator contacted — no automated response
  | { phase: 'done' }

// ── Helpers ───────────────────────────────────────────────────────────────────

function ConfidenceBar({ value, outcome }: { value: number; outcome?: Msg['outcome'] }) {
  const color = outcome === 'hit' ? '#16a34a' : outcome === 'question' ? '#2563eb' : '#7c3aed'
  return (
    <span className="inline-flex items-center gap-1.5 ml-2">
      <span className="inline-block rounded-full" style={{
        width: `${Math.round(value * 48)}px`, height: '5px',
        background: color, opacity: 0.85, minWidth: '4px',
      }} />
      <span style={{ color, fontSize: '10px', fontWeight: 700 }}>{value.toFixed(2)}</span>
    </span>
  )
}

function OutcomeBadge({ outcome }: { outcome?: Msg['outcome'] }) {
  if (outcome === 'hit')      return <Badge color="#16a34a" bg="#f0fdf4" label="✓ hit" />
  if (outcome === 'question') return <Badge color="#2563eb" bg="#eff6ff" label="? question" />
  if (outcome === 'llm')      return <Badge color="#7c3aed" bg="#f5f3ff" label="→ LLM" />
  return null
}

function Badge({ color, bg, label }: { color: string; bg: string; label: string }) {
  return (
    <span className="inline-block rounded-full px-2 py-0.5 text-xs font-semibold ml-1.5"
      style={{ color, background: bg, border: `1px solid ${color}30` }}>
      {label}
    </span>
  )
}

function Avatar({ letter, color, bg, border }: { letter: string; color: string; bg: string; border: string }) {
  return (
    <div className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold mt-0.5"
      style={{ background: bg, color, border: `1px solid ${border}` }}>
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
    <div className="flex justify-end">
      <div className="rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm max-w-xs"
        style={{ background: '#1e293b', color: '#f1f5f9' }}>{msg.text}</div>
    </div>
  )

  if (msg.kind === 'processing') {
    const conf = msg.sub ? parseFloat(msg.sub.replace('confidence ', '')) : NaN
    return (
      <div className="flex items-start gap-2 py-1.5 px-3 rounded-lg text-xs"
        style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }}>
        <span style={{ color: '#94a3b8', fontFamily: 'monospace', marginTop: '1px' }}>⟳</span>
        <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
          <span style={{ color: '#64748b', fontFamily: 'monospace' }}>{msg.text}</span>
          {!isNaN(conf) && <ConfidenceBar value={conf} outcome={msg.outcome} />}
          <OutcomeBadge outcome={msg.outcome} />
        </div>
      </div>
    )
  }

  if (msg.kind === 'bot') return (
    <div className="flex justify-start">
      <div className="flex items-start gap-2.5 max-w-sm">
        <Avatar letter="E" color="#64748b" bg="#f1f5f9" border="#e2e8f0" />
        <div className="rounded-2xl rounded-tl-sm px-4 py-2.5 text-sm"
          style={{ background: '#fff', border: '1px solid #e2e8f0', color: '#1e293b' }}>{msg.text}</div>
      </div>
    </div>
  )

  if (msg.kind === 'breaking') return (
    <div className="flex justify-start">
      <div className="flex items-start gap-2.5 max-w-sm">
        <Avatar letter="E" color="#2563eb" bg="#eff6ff" border="#bfdbfe" />
        <div className="rounded-2xl rounded-tl-sm px-4 py-2.5 text-sm"
          style={{ background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1e40af' }}>{msg.text}</div>
      </div>
    </div>
  )

  if (msg.kind === 'action') return (
    <div className="flex justify-start ml-9">
      <div className="flex items-start gap-2 rounded-lg px-3 py-2 text-xs font-mono"
        style={{ background: '#fefce8', border: '1px solid #fde047', color: '#854d0e' }}>
        <span style={{ color: '#ca8a04', fontSize: '13px', marginTop: '1px' }}>⚡</span>
        <div>
          <div className="font-semibold mb-0.5" style={{ color: '#78350f', fontSize: '9px', letterSpacing: '0.05em' }}>
            {msg.sub?.toUpperCase()}
          </div>
          <div>{msg.text}</div>
        </div>
      </div>
    </div>
  )

  if (msg.kind === 'action-confirm') return (
    <div className="flex justify-start ml-9">
      <div className="flex items-start gap-2 rounded-lg px-3 py-2 text-xs font-mono"
        style={{ background: '#fff7ed', border: '1.5px solid #f97316', color: '#9a3412' }}>
        <span style={{ color: '#ea580c', fontSize: '13px', marginTop: '1px' }}>⚠️</span>
        <div>
          <div className="font-semibold mb-0.5" style={{ color: '#7c2d12', fontSize: '9px', letterSpacing: '0.05em' }}>
            CONFIRMATION REQUIRED · NON-REVERTABLE
          </div>
          <div>{msg.text}</div>
        </div>
      </div>
    </div>
  )

  if (msg.kind === 'revert') return (
    <div className="flex justify-start ml-9">
      <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-mono"
        style={{ background: '#f0f9ff', border: '1px solid #bae6fd', color: '#0369a1' }}>
        <span style={{ fontSize: '12px' }}>↩</span>
        <div>
          <div className="font-semibold mb-0.5" style={{ fontSize: '9px', letterSpacing: '0.05em', color: '#0c4a6e' }}>
            {msg.sub?.toUpperCase()}
          </div>
          <div>{msg.text}</div>
        </div>
      </div>
    </div>
  )

  if (msg.kind === 'negative') return (
    <div className="flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg"
      style={{ background: '#fff7ed', border: '1px solid #fed7aa', color: '#9a3412' }}>
      <span>↓</span>
      <div>
        <span className="font-semibold" style={{ fontFamily: 'monospace' }}>{msg.text}</span>
        <span className="ml-2" style={{ color: '#c2410c', opacity: 0.8 }}>{msg.sub}</span>
      </div>
    </div>
  )

  if (msg.kind === 'learning') return (
    <div className="flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg"
      style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#15803d' }}>
      <span>↑</span>
      <div>
        <span className="font-semibold" style={{ fontFamily: 'monospace' }}>{msg.text}</span>
        <span className="ml-2" style={{ color: '#16a34a', opacity: 0.7 }}>{msg.sub}</span>
      </div>
    </div>
  )

  if (msg.kind === 'llm-handoff') return (
    <div className="flex justify-start ml-9">
      <div className="rounded-lg px-3 py-2 text-xs"
        style={{ background: '#faf5ff', border: '1px solid #ddd6fe', color: '#6d28d9', maxWidth: '320px' }}>
        <div className="font-semibold mb-1" style={{ color: '#7c3aed', fontSize: '9px', letterSpacing: '0.05em' }}>
          {msg.sub?.toUpperCase()}
        </div>
        <div style={{ fontFamily: 'monospace', color: '#5b21b6', fontSize: '10px', wordBreak: 'break-word' }}>
          {msg.text}
        </div>
      </div>
    </div>
  )

  if (msg.kind === 'feedback') return (
    <div className="flex justify-start ml-9">
      <div className="rounded-xl px-4 py-3" style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }}>
        <div className="text-xs font-medium text-slate-500 mb-2.5">{msg.text}</div>
        <div className="flex gap-2">
          <button
            onClick={!feedbackDisabled ? onYes : undefined}
            disabled={feedbackDisabled}
            className="px-3.5 py-1.5 rounded-lg text-xs font-semibold"
            style={{
              background: '#f0fdf4', border: '1.5px solid #bbf7d0', color: '#15803d',
              opacity: feedbackDisabled ? 0.35 : 1,
              cursor: feedbackDisabled ? 'default' : 'pointer',
            }}
          >✓ Yes, solved</button>
          <button
            onClick={!feedbackDisabled ? onNo : undefined}
            disabled={feedbackDisabled}
            className="px-3.5 py-1.5 rounded-lg text-xs font-semibold"
            style={{
              background: '#fff7ed', border: '1.5px solid #fed7aa', color: '#9a3412',
              opacity: feedbackDisabled ? 0.35 : 1,
              cursor: feedbackDisabled ? 'default' : 'pointer',
            }}
          >✗ No, still failing</button>
        </div>
      </div>
    </div>
  )

  if (msg.kind === 'feedback-no') return (
    <div className="flex justify-end">
      <div className="rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm"
        style={{ background: '#7f1d1d', color: '#fecaca' }}>{msg.text}</div>
    </div>
  )

  if (msg.kind === 'session-end') return (
    <div className="rounded-xl px-4 py-3 text-xs text-center"
      style={{ background: '#f8fafc', border: '1px dashed #cbd5e1', color: '#64748b' }}>
      <div className="font-semibold mb-1" style={{ color: '#475569' }}>Session closed</div>
      <div style={{ lineHeight: '1.5' }}>{msg.text}</div>
    </div>
  )

  return null
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function EngramFlow() {
  const [flowState, setFlowState]     = useState<FlowState>({ phase: 'playing-initial' })
  const [messages, setMessages]       = useState<Msg[]>([])
  const [visibleCount, setVisible]    = useState(0)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const bottomRef = useRef<HTMLDivElement>(null)

  function clearTimers() { timers.current.forEach(clearTimeout); timers.current = [] }

  function scheduleSegment(segment: Msg[], onDone?: () => void) {
    clearTimers()
    setMessages(prev => [...prev, ...segment])
    setVisible(prev => {
      let base = prev
      let cumulative = 0
      segment.forEach((msg, i) => {
        cumulative += msg.delay
        const t = setTimeout(() => setVisible(base + i + 1), cumulative)
        timers.current.push(t)
      })
      if (onDone) {
        const total = segment.reduce((s, m) => s + m.delay, 0)
        const t = setTimeout(onDone, total + 50)
        timers.current.push(t)
      }
      return prev
    })
  }

  // Start on mount
  useEffect(() => {
    setMessages(initialMsgs)
    let cumulative = 300
    initialMsgs.forEach((_, i) => {
      cumulative += initialMsgs[i].delay
      const t = setTimeout(() => setVisible(i + 1), cumulative)
      timers.current.push(t)
    })
    const total = initialMsgs.reduce((s, m) => s + m.delay, 300)
    const t = setTimeout(() => setFlowState({ phase: 'await-1' }), total + 50)
    timers.current.push(t)
    return clearTimers
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [visibleCount])

  function handleYes1() {
    setFlowState({ phase: 'playing-yes1' })
    scheduleSegment(yes1Msgs, () => setFlowState({ phase: 'done' }))
  }

  function handleNo1() {
    setFlowState({ phase: 'playing-no1' })
    scheduleSegment(no1Msgs, () => setFlowState({ phase: 'await-2' }))
  }

  function handleYes2() {
    setFlowState({ phase: 'playing-yes2' })
    scheduleSegment(yes2Msgs, () => setFlowState({ phase: 'done' }))
  }

  function handleNo2() {
    setFlowState({ phase: 'playing-no2' })
    scheduleSegment(no2Msgs, () => setFlowState({ phase: 'await-3' }))
  }

  function handleYes3() {
    setFlowState({ phase: 'playing-yes3' })
    scheduleSegment(yes3Msgs, () => setFlowState({ phase: 'done' }))
  }

  function handleNo3() {
    setFlowState({ phase: 'playing-no3' })
    scheduleSegment(no3Msgs, () => setFlowState({ phase: 'await-4' }))
  }

  function handleYes4() {
    setFlowState({ phase: 'playing-yes4' })
    scheduleSegment(yes4Msgs, () => setFlowState({ phase: 'done' }))
  }

  function handleNo4() {
    setFlowState({ phase: 'playing-no4' })
    scheduleSegment(no4Msgs, () => setFlowState({ phase: 'waiting-operator' }))
  }

  function restart() {
    clearTimers()
    setMessages(initialMsgs)
    setVisible(0)
    setFlowState({ phase: 'playing-initial' })
    let cumulative = 300
    initialMsgs.forEach((_, i) => {
      cumulative += initialMsgs[i].delay
      const t = setTimeout(() => setVisible(i + 1), cumulative)
      timers.current.push(t)
    })
    const total = initialMsgs.reduce((s, m) => s + m.delay, 300)
    const t = setTimeout(() => setFlowState({ phase: 'await-1' }), total + 50)
    timers.current.push(t)
  }

  const phase = flowState.phase
  const visible = messages.slice(0, visibleCount)
  const isPlaying = phase === 'playing-initial' || phase === 'playing-no1' || phase === 'playing-yes1' || phase === 'playing-yes2' || phase === 'playing-no2' || phase === 'playing-yes3' || phase === 'playing-no3' || phase === 'playing-yes4' || phase === 'playing-no4' || phase === 'waiting-operator'

  // Which feedback index are we waiting at?
  const feedbackIndices = visible.reduce<number[]>((acc, m, i) => m.kind === 'feedback' ? [...acc, i] : acc, [])
  const firstFeedbackIdx  = feedbackIndices[0] ?? -1
  const secondFeedbackIdx = feedbackIndices[1] ?? -1
  const thirdFeedbackIdx  = feedbackIndices[2] ?? -1
  const fourthFeedbackIdx = feedbackIndices[3] ?? -1

  const legendItems = [
    { color: '#16a34a', label: '✓ Knowledge hit', desc: 'no LLM cost' },
    { color: '#2563eb', label: '? Breaking question', desc: 'reduces ambiguity' },
    { color: '#7c3aed', label: '→ LLM fallback', desc: 'structured handoff' },
    { color: '#ca8a04', label: '⚡ Revertable action', desc: 'can be undone' },
    { color: '#ea580c', label: '⚠ Non-revertable', desc: 'requires confirmation' },
    { color: '#0369a1', label: '↩ Action reverted', desc: 'rolled back' },
    { color: '#c2410c', label: '↓ Path weakens', desc: 'negative reinforcement' },
    { color: '#15803d', label: '↑ Graph learns', desc: 'cheaper next time' },
  ]

  return (
    <section className="min-h-screen flex flex-col items-center px-4 py-16 bg-slate-50">
      <div className="w-full max-w-4xl">

        {/* Header — spans full width above both columns */}
        <div className="text-center mb-8">
          <div className="inline-block text-xs font-semibold tracking-widest text-slate-400 uppercase mb-3">Engram</div>
          <h2 className="text-2xl font-semibold text-slate-800 mb-2">
            Answers what it knows. Asks what it needs. Hands off the rest.
          </h2>
          <p className="text-sm text-slate-500">
            Follow the conversation — click <strong>Yes / No</strong> when prompted.
          </p>
        </div>

        {/* Two-column layout — chat + legend aligned at the same top edge */}
        <div className="grid items-start gap-6" style={{ gridTemplateColumns: '650px 13rem' }}>

        {/* Main conversation column */}
        <div className="min-w-0 overflow-hidden">
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            {/* Title bar */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100" style={{ background: '#f8fafc' }}>
              <div className="flex items-center gap-2">
                {['#e2e8f0','#e2e8f0','#e2e8f0'].map((c,i) => (
                  <div key={i} className="w-2.5 h-2.5 rounded-full" style={{ background: c }} />
                ))}
                <span className="ml-2 text-xs font-semibold tracking-wide" style={{ color: '#94a3b8' }}>
                  engram — interactive session
                </span>
              </div>
              {(phase === 'done' || phase === 'waiting-operator') && (
                <button
                  onClick={restart}
                  className="text-xs px-2.5 py-1 rounded-md cursor-pointer"
                  style={{ background: '#f1f5f9', color: '#64748b', border: '1px solid #e2e8f0' }}
                >↺ restart</button>
              )}
            </div>

            {/* Messages — scrollable, capped to viewport */}
            <div className="flex flex-col gap-3 p-5 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 320px)', minHeight: '14rem' }}>
              {visible.length === 0 && (
                <div className="flex items-center justify-center flex-1">
                  <span className="text-xs text-slate-300">Starting…</span>
                </div>
              )}

              {visible.map((msg, i) => {
                const isFirstFeedback  = msg.kind === 'feedback' && i === firstFeedbackIdx
                const isSecondFeedback = msg.kind === 'feedback' && i === secondFeedbackIdx
                const isThirdFeedback  = msg.kind === 'feedback' && i === thirdFeedbackIdx
                const isFourthFeedback = msg.kind === 'feedback' && i === fourthFeedbackIdx
                const fb1Disabled = phase !== 'await-1'
                const fb2Disabled = phase !== 'await-2'
                const fb3Disabled = phase !== 'await-3'
                const fb4Disabled = phase !== 'await-4'

                return (
                  <div key={i} style={{ animation: 'fadeSlideIn 0.25s ease both' }}>
                    <Bubble
                      msg={msg}
                      feedbackDisabled={
                        isFirstFeedback  ? fb1Disabled :
                        isSecondFeedback ? fb2Disabled :
                        isThirdFeedback  ? fb3Disabled :
                        isFourthFeedback ? fb4Disabled : undefined
                      }
                      onYes={isFirstFeedback ? handleYes1 : isSecondFeedback ? handleYes2 : isThirdFeedback ? handleYes3 : isFourthFeedback ? handleYes4 : undefined}
                      onNo ={isFirstFeedback ? handleNo1  : isSecondFeedback ? handleNo2  : isThirdFeedback ? handleNo3  : isFourthFeedback ? handleNo4  : undefined}
                    />
                  </div>
                )
              })}

              {isPlaying && (
                <div className="flex gap-1 ml-9">
                  {[0,1,2].map(i => (
                    <div key={i} className="w-1.5 h-1.5 rounded-full"
                      style={{ background: '#cbd5e1', animation: `pulse 1.2s ${i * 0.2}s ease-in-out infinite` }} />
                  ))}
                </div>
              )}

              <div ref={bottomRef} />
            </div>
          </div>
        </div>

        {/* Sticky legend column */}
        <div className="sticky top-16">
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-4">
            <div className="text-xs font-semibold tracking-widest text-slate-400 uppercase mb-3">Legend</div>
            <div className="flex flex-col gap-2.5">
              {legendItems.map(item => (
                <div key={item.label} className="flex items-start gap-2">
                  <span className="w-2 h-2 rounded-full flex-shrink-0 mt-1" style={{ background: item.color }} />
                  <div>
                    <div className="text-xs font-medium" style={{ color: '#334155' }}>{item.label}</div>
                    <div className="text-xs" style={{ color: '#94a3b8' }}>{item.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        </div>{/* end two-column flex */}
      </div>{/* end max-w-4xl */}

      <style>{`
        @keyframes fadeSlideIn {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 0.3; transform: scale(0.8); }
          50%       { opacity: 1;   transform: scale(1.1); }
        }
      `}</style>
    </section>
  )
}

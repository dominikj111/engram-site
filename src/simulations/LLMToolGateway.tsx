import { useState, useEffect, useRef, useCallback } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────

type Verdict = 'allowed' | 'blocked' | 'confirm' | 'exception'

interface CheckStep {
  check:  string
  result: string
  pass:   boolean
}

interface Terminus {
  kind:  'envelope' | 'engine'
  node:  string
  emits: string
}

interface ReevalDef {
  contextAdded: string
  priorContext: string[]    // cumulative — grows with each recovery round
  steps:        CheckStep[]
  verdict:      Verdict
  outcome:      string
  terminus:     Terminus
  reeval?:      ReevalDef  // chain a further round if this round also throws
}

interface CallDef {
  tool:     string
  params:   string
  verdict:  Verdict
  steps:    CheckStep[]
  outcome:  string
  terminus: Terminus
  reeval?:  ReevalDef
}

interface ActiveState {
  instance:   number
  def:        CallDef
  priorCtx:   string[]
  contextNew: string
  steps:      number
  verdict:    boolean
  terminus:   boolean
}

interface HistoryEntry {
  hid:       number
  tool:      string
  params:    string
  verdict:   Verdict
  outcome:   string
  isReeval?: boolean
}

// ── Call sequence ──────────────────────────────────────────────────────────────

const CALLS: CallDef[] = [
  // ── 1. Simple allowed — sets the scene
  {
    tool: 'engram.query',
    params: '"auth timeout pattern"',
    verdict: 'allowed',
    steps: [
      { check: 'Contract',   result: 'In actions.json',           pass: true },
      { check: 'Permission', result: 'None required — open read', pass: true },
    ],
    outcome: 'dispatched to execution layer',
    terminus: {
      kind:  'envelope',
      node:  'solution_node',
      emits: 'ResponseEnvelope → LLM: { path: CheckConnectionPool, confidence: 0.91, ruled_out: [...] }',
    },
  },

  // ── 2. Single re-eval ↺ — intro to exception recovery
  {
    tool: 'GetServiceStatus',
    params: 'service="monitoring-api"',
    verdict: 'exception',
    steps: [
      { check: 'Contract',   result: 'In actions.json',                              pass: true  },
      { check: 'Execution',  result: 'service_unavailable — monitoring-api timeout', pass: false },
    ],
    outcome: 'service_unavailable exception returned to graph — monitoring-api timeout',
    terminus: {
      kind:  'engine',
      node:  'service_unavailable',
      emits: 'graph re-evaluates with exception context → checks cache fallback',
    },
    reeval: {
      contextAdded: 'monitoring-api timeout → cache hit available (TTL 120s)',
      priorContext: [
        'monitoring-api: service_unavailable (timeout)',
      ],
      steps: [
        { check: 'Context',   result: 'cache hit available — TTL valid',     pass: true },
        { check: 'Execution', result: 'serve from cache → status: degraded', pass: true },
      ],
      verdict: 'allowed',
      outcome: 'cached response dispatched to execution layer',
      terminus: {
        kind:  'envelope',
        node:  'solution_node',
        emits: 'ResponseEnvelope → LLM: { service_status: degraded, source: cache, age: 47s }',
      },
    },
  },

  // ── 3. Blocked — permission
  {
    tool: 'DeleteUser',
    params: 'account_id=42',
    verdict: 'blocked',
    steps: [
      { check: 'Contract',   result: 'In actions.json',                         pass: true  },
      { check: 'Permission', result: 'Admin required — session: Authenticated', pass: false },
    ],
    outcome: 'execution layer not reached',
    terminus: {
      kind:  'engine',
      node:  'permission_denied',
      emits: 'ResponseEnvelope → LLM: "Authenticate as Admin to proceed with DeleteUser?"',
    },
  },

  // ── 4. Blocked — unknown action
  {
    tool: 'DropDatabase',
    params: 'name="production"',
    verdict: 'blocked',
    steps: [
      { check: 'Contract', result: 'Not in actions.json — no execution pathway exists', pass: false },
    ],
    outcome: 'execution layer not reached',
    terminus: {
      kind:  'engine',
      node:  'unknown_action',
      emits: 'ResponseEnvelope → LLM: escalation payload with confirmed facts + session_id',
    },
  },

  // ── 5. Confirm
  {
    tool: 'CancelService',
    params: 'account_id=42, reason="non-payment"',
    verdict: 'confirm',
    steps: [
      { check: 'Contract',     result: 'In actions.json',                     pass: true },
      { check: 'Permission',   result: 'Authenticated — met',                 pass: true },
      { check: 'Confirmation', result: 'Required — destructive, no rollback', pass: true },
    ],
    outcome: 'execution layer paused — awaiting confirmation',
    terminus: {
      kind:  'engine',
      node:  'confirmation_required',
      emits: 'ResponseEnvelope → LLM: "Confirm cancellation for account 42? This cannot be undone."',
    },
  },

  // ── 6. SHOWCASE: double re-eval ↺↺
  //    exception → ↺ exception → ↺↺ allowed
  //    LLM sees only the final ResponseEnvelope — two full recovery rounds invisible to it
  {
    tool: 'ProcessPayment',
    params: 'account_id=42, amount=149.00, currency="GBP"',
    verdict: 'exception',
    steps: [
      { check: 'Contract',   result: 'In actions.json',                               pass: true  },
      { check: 'Permission', result: 'Verified — met',                                pass: true  },
      { check: 'Execution',  result: 'gateway_timeout — payment gateway unresponsive', pass: false },
    ],
    outcome: 'gateway_timeout exception returned to graph — fallback route queued',
    terminus: {
      kind:  'engine',
      node:  'service_unavailable',
      emits: 'graph re-evaluates → selects fallback gateway, queues fraud check',
    },
    reeval: {
      // Round 1: fallback gateway responds, but fraud check hangs (risk-api down)
      contextAdded: 'gateway_timeout → fallback gateway selected, fraud check queued',
      priorContext: [
        'gateway_timeout — payment gateway unresponsive',
      ],
      steps: [
        { check: 'Context',   result: 'fallback gateway available — route confirmed',  pass: true  },
        { check: 'Execution', result: 'fraud_check_pending — risk-api timeout (502)',   pass: false },
      ],
      verdict: 'exception',
      outcome: 'exception returned to graph — fraud check incomplete',
      terminus: {
        kind:  'engine',
        node:  'service_unavailable',
        emits: 'graph re-evaluates → waits for risk-api recovery, retries fraud check',
      },
      reeval: {
        // Round 2: risk-api recovered, fraud check passes, payment authorised
        contextAdded: 'risk-api recovered → fraud check passed → payment approved',
        priorContext: [
          'gateway_timeout — payment gateway unresponsive',
          'fraud_check_pending — risk-api timeout (502)',
        ],
        steps: [
          { check: 'Context',   result: 'risk-api recovered, fraud check: pass',         pass: true },
          { check: 'Recovery',  result: 'fallback gateway → ProcessPayment: 200 OK',      pass: true },
          { check: 'Execution', result: 'payment authorised — txn_id: TXN-20260408-042', pass: true },
        ],
        verdict: 'allowed',
        outcome: 'payment dispatched to execution layer',
        terminus: {
          kind:  'envelope',
          node:  'solution_node',
          emits: 'ResponseEnvelope → LLM: { status: authorised, txn_id: TXN-20260408-042, amount: £149.00 }',
        },
      },
    },
  },

  // ── 7. Allowed
  {
    tool: 'CheckLineStatus',
    params: 'postcode="BT1 4AB"',
    verdict: 'allowed',
    steps: [
      { check: 'Contract',   result: 'In actions.json',           pass: true },
      { check: 'Permission', result: 'None required — read-only', pass: true },
    ],
    outcome: 'dispatched to execution layer',
    terminus: {
      kind:  'envelope',
      node:  'solution_node',
      emits: 'ResponseEnvelope → LLM: { line_status: degraded, latency: 420ms }',
    },
  },

  // ── 8. Allowed (with rate-limit check)
  {
    tool: 'RebootRouter',
    params: 'device_id="RTR-0042"',
    verdict: 'allowed',
    steps: [
      { check: 'Contract',   result: 'In actions.json',                pass: true },
      { check: 'Permission', result: 'Verified — met',                 pass: true },
      { check: 'Rate limit', result: '3/hour — 1 used, within limit',  pass: true },
    ],
    outcome: 'dispatched to execution layer',
    terminus: {
      kind:  'envelope',
      node:  'solution_node',
      emits: 'ResponseEnvelope → LLM: { action: RebootRouter, status: dispatched, session_id }',
    },
  },

  // ── 9. Single re-eval ↺ — auth recovery
  {
    tool: 'FetchUserProfile',
    params: 'user_id=42, service="profile-api"',
    verdict: 'exception',
    steps: [
      { check: 'Contract',   result: 'In actions.json',                           pass: true  },
      { check: 'Permission', result: 'Authenticated — met',                       pass: true  },
      { check: 'Execution',  result: 'service_unavailable — profile-api timeout', pass: false },
    ],
    outcome: 'service_unavailable exception returned to graph — profile-api timeout',
    terminus: {
      kind:  'engine',
      node:  'service_unavailable',
      emits: 'graph re-evaluates with exception context → queues recovery actions',
    },
    reeval: {
      contextAdded: 'service_unavailable → RefreshToken queued → token refreshed',
      priorContext: [
        'profile-api: service_unavailable (timeout)',
      ],
      steps: [
        { check: 'Context',   result: 'service_unavailable + auth_expired detected', pass: true },
        { check: 'Recovery',  result: 'RefreshToken completed — new token valid',    pass: true },
        { check: 'Execution', result: 'retry FetchUserProfile → 200 OK',             pass: true },
      ],
      verdict: 'allowed',
      outcome: 'recovery dispatched to execution layer',
      terminus: {
        kind:  'envelope',
        node:  'solution_node',
        emits: 'ResponseEnvelope → LLM: { user_id: 42, plan: pro, status: ok }',
      },
    },
  },

  // ── 10. Blocked
  {
    tool: 'ExportUserData',
    params: 'account_id=42, format="csv"',
    verdict: 'blocked',
    steps: [
      { check: 'Contract',   result: 'In actions.json',                    pass: true  },
      { check: 'Permission', result: 'Admin required — session: Verified', pass: false },
    ],
    outcome: 'execution layer not reached',
    terminus: {
      kind:  'engine',
      node:  'permission_denied',
      emits: 'ResponseEnvelope → LLM: escalation payload, missing: Admin permission',
    },
  },

  // ── 11. Confirm
  {
    tool: 'ScheduleEngineer',
    params: 'slot="2026-04-08T09:00", account_id=42',
    verdict: 'confirm',
    steps: [
      { check: 'Contract',     result: 'In actions.json',               pass: true },
      { check: 'Permission',   result: 'Verified — met',                pass: true },
      { check: 'Confirmation', result: 'Required — rollback available', pass: true },
    ],
    outcome: 'execution layer paused — awaiting confirmation',
    terminus: {
      kind:  'engine',
      node:  'confirmation_required',
      emits: 'ResponseEnvelope → LLM: "Confirm engineer visit on 2026-04-08 at 09:00?"',
    },
  },

  // ── 12. Allowed — closes the loop
  {
    tool: 'engram.confirm',
    params: 'session_id="2026-04-01-007", outcome=resolved',
    verdict: 'allowed',
    steps: [
      { check: 'Contract',   result: 'In actions.json',                  pass: true },
      { check: 'Permission', result: 'None required — session feedback', pass: true },
    ],
    outcome: 'dispatched to execution layer',
    terminus: {
      kind:  'envelope',
      node:  'solution_node',
      emits: 'ResponseEnvelope → LLM: { status: confirmed, weights_updated: true }',
    },
  },
]

// ── Timing (ms) ───────────────────────────────────────────────────────────────

const STEP_MS    = 900
const VERD_MS    = 650
const TERM_MS    = 900
const HOLD_MS    = 3000
const INTER_MS   = 600
const REEVAL_GAP = 400

// ── Small components ──────────────────────────────────────────────────────────

function VerdictChip({ verdict }: { verdict: Verdict }) {
  const m: Record<Verdict, { label: string; color: string; bg: string; border: string }> = {
    allowed:   { label: '✓ Allowed',   color: '#16a34a', bg: '#f0fdf4', border: '#bbf7d0' },
    blocked:   { label: '✕ Blocked',   color: '#dc2626', bg: '#fef2f2', border: '#fecaca' },
    confirm:   { label: '? Confirm',   color: '#d97706', bg: '#fffbeb', border: '#fde68a' },
    exception: { label: '⚠ Exception', color: '#b45309', bg: '#fff7ed', border: '#fed7aa' },
  }
  const s = m[verdict]
  return (
    <span style={{
      fontSize: '11px', fontWeight: 600, color: s.color,
      background: s.bg, border: `1px solid ${s.border}`,
      borderRadius: '20px', padding: '1px 8px', whiteSpace: 'nowrap',
      flexShrink: 0, display: 'inline-block', minWidth: '76px', textAlign: 'center',
    }}>
      {s.label}
    </span>
  )
}

function StatBlock({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <div style={{ padding: '9px 16px', minWidth: '80px' }}>
      <div style={{ fontSize: '22px', fontWeight: 700, color, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
        {value}
      </div>
      <div style={{ fontSize: '10px', color: '#94a3b8', marginTop: '3px' }}>{label}</div>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function LLMToolGateway({ paused = false }: { paused?: boolean }) {
  const [active,  setActive]  = useState<ActiveState | null>(null)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [stats,   setStats]   = useState({ allowed: 0, blocked: 0, confirm: 0, exception: 0 })

  const timers      = useRef<ReturnType<typeof setTimeout>[]>([])
  const alive       = useRef(true)
  const hidRef      = useRef(0)
  const instanceRef = useRef(0)
  const pausedRef   = useRef(paused)
  useEffect(() => { pausedRef.current = paused }, [paused])

  const sched = useCallback((delay: number, fn: () => void) => {
    const id = setTimeout(() => {
      if (!alive.current) return
      if (pausedRef.current) {
        const poll = setInterval(() => {
          if (!alive.current) { clearInterval(poll); return }
          if (!pausedRef.current) { clearInterval(poll); fn() }
        }, 100)
        timers.current.push(poll as unknown as ReturnType<typeof setTimeout>)
        return
      }
      fn()
    }, delay)
    timers.current.push(id)
  }, [])

  const startEval = useCallback((
    def: CallDef,
    priorCtx: string[],
    contextNew: string,
    onDone: () => void,
    isReeval: boolean,
  ) => {
    const instance = instanceRef.current++
    setActive({ instance, def, priorCtx, contextNew, steps: 0, verdict: false, terminus: false })

    function doStep(i: number) {
      sched(STEP_MS, () => {
        setActive(a => a?.instance === instance ? { ...a, steps: i + 1 } : a)
        if (i + 1 < def.steps.length) doStep(i + 1)
        else showVerdict()
      })
    }

    function showVerdict() {
      sched(VERD_MS, () => {
        setActive(a => a?.instance === instance ? { ...a, verdict: true } : a)
        setStats(s => ({ ...s, [def.verdict]: s[def.verdict] + 1 }))
        showTerminus()
      })
    }

    function showTerminus() {
      sched(TERM_MS, () => {
        setActive(a => a?.instance === instance ? { ...a, terminus: true } : a)
        sched(HOLD_MS, () => {
          setHistory(h => [{
            hid: hidRef.current++,
            tool: def.tool, params: def.params,
            verdict: def.verdict, outcome: def.outcome,
            isReeval,
          }, ...h.slice(0, 19)])
          setActive(null)
          sched(INTER_MS, onDone)
        })
      })
    }

    doStep(0)
  }, [sched])

  const runCall = useCallback((idx: number) => {
    const def = CALLS[idx % CALLS.length]

    // Recursively process re-eval chain — each round may itself throw and chain another
    function processReeval(r: ReevalDef, onDone: () => void) {
      const reevalDef: CallDef = {
        tool: def.tool, params: def.params,
        verdict: r.verdict, steps: r.steps, outcome: r.outcome, terminus: r.terminus,
      }
      sched(REEVAL_GAP, () => {
        startEval(reevalDef, r.priorContext, r.contextAdded, () => {
          r.reeval ? processReeval(r.reeval, onDone) : onDone()
        }, true)
      })
    }

    startEval(def, [], '', () => {
      def.reeval ? processReeval(def.reeval, () => runCall(idx + 1)) : runCall(idx + 1)
    }, false)
  }, [startEval, sched])

  useEffect(() => {
    alive.current = true
    sched(500, () => runCall(0))
    return () => { alive.current = false; timers.current.forEach(clearTimeout) }
  }, [runCall, sched])

  const total = stats.allowed + stats.blocked + stats.confirm + stats.exception

  const lastActiveRef = useRef<ActiveState | null>(null)
  if (active) lastActiveRef.current = active
  const display = active ?? lastActiveRef.current

  const panelOpacity = active != null ? 1 : paused ? 1 : 0

  const termCfg = display?.def.terminus.kind === 'envelope'
    ? { label: 'RESPONSE', color: '#15803d', bg: '#f0fdf4', border: '#bbf7d0' }
    : { label: 'ENGINE',   color: '#7c3aed', bg: '#faf5ff', border: '#ddd6fe' }

  const borderColor = display?.verdict
    ? display.def.verdict === 'blocked'   ? '#fecaca'
    : display.def.verdict === 'confirm'   ? '#fde68a'
    : display.def.verdict === 'exception' ? '#fed7aa'
    : '#bbf7d0'
    : '#e2e8f0'

  const hasCtx = (display?.priorCtx?.length ?? 0) > 0 || !!display?.contextNew

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: '14px 20px', gap: '10px' }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div>
          <span style={{ fontSize: '13px', fontWeight: 600, color: '#0f172a' }}>Policy Engine — LLM Tool Calls</span>
          <span style={{ fontSize: '12px', color: '#94a3b8', marginLeft: '10px' }}>
            every call evaluated — always ends with ResponseEnvelope to LLM
          </span>
        </div>
        <div style={{ display: 'flex', gap: '6px' }}>
          {(['allowed', 'confirm', 'exception', 'blocked'] as Verdict[]).map(v => <VerdictChip key={v} verdict={v} />)}
        </div>
      </div>

      {/* ── Architecture strip ── */}
      <div style={{
        flexShrink: 0, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '4px',
        padding: '8px 14px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px',
        fontSize: '11px',
      }}>
        <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 700, color: '#0f172a' }}>LLM tool call</span>
        <span style={{ color: '#94a3b8' }}> → </span>
        <span style={{ fontWeight: 700, color: '#2563eb' }}>PolicyEngine</span>
        <span style={{ color: '#94a3b8', fontSize: '10px' }}>[actions.json · policies.json]</span>
        <span style={{ color: '#94a3b8' }}> → </span>
        <span style={{ fontWeight: 600, color: '#15803d' }}>Execution layer</span>
        <span style={{ color: '#94a3b8' }}> → </span>
        <span style={{ fontWeight: 600, color: '#15803d' }}>solution_node</span>
        <span style={{ color: '#94a3b8' }}> → </span>
        <span style={{ fontWeight: 600, color: '#0f172a' }}>ResponseEnvelope → LLM</span>
        <span style={{ color: '#cbd5e1', margin: '0 5px' }}>|</span>
        <span style={{ color: '#7c3aed', fontWeight: 600 }}>ENGINE</span>
        <span style={{ color: '#64748b' }}> node on block/confirm/exception → still ends with ResponseEnvelope</span>
        <span style={{ color: '#cbd5e1', margin: '0 5px' }}>|</span>
        <span style={{ color: '#b45309', fontWeight: 600 }}>↺ re-eval</span>
        <span style={{ color: '#64748b' }}> → accumulates context, retries, LLM never sees the loop</span>
      </div>

      {/* ── Evaluation panel ── */}
      <div style={{
        flexShrink: 0,
        background: '#fff', borderRadius: '10px', padding: '10px 14px',
        border: `2px solid ${borderColor}`,
        transition: 'border-color 0.25s ease, opacity 0.2s ease',
        opacity: panelOpacity,
      }}>

        {/* ── Accumulated context zone ──────────────────────────────────────────
            Always rendered + always takes the same height.
            On normal calls the slots are faint placeholders; they fill up during re-eval.
            A permanent header label orients readers even when the zone is idle.       */}
        <div style={{
          marginBottom: '6px', paddingBottom: '6px',
          borderBottom: `1px solid ${hasCtx ? '#fde68a' : '#e2e8f0'}`,
          transition: 'border-color 0.35s ease',
        }}>
          {/* Header — always visible; colour activates when context arrives */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px' }}>
            <span style={{
              fontSize: '9px', fontWeight: 700, letterSpacing: '0.07em',
              color: hasCtx ? '#b45309' : '#94a3b8',
              transition: 'color 0.35s ease',
            }}>↺ ACCUMULATED CONTEXT</span>
            {!hasCtx && (
              <span style={{ fontSize: '10px', color: '#cbd5e1', fontStyle: 'italic' }}>
                — populates during re-evaluation
              </span>
            )}
          </div>

          {/* 3 fixed CTX slots — prior rounds + current round all shown as CTX N.
              Always rendered for stable height; faint placeholder when empty.     */}
          {(() => {
            const allCtx = [
              ...(display?.priorCtx ?? []),
              ...(display?.contextNew ? [display.contextNew] : []),
            ]
            return [0, 1, 2].map(i => {
              const ctx = allCtx[i]
              return (
                <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px',
                  opacity: ctx ? 1 : 0.2,
                  transition: 'opacity 0.4s ease',
                }}>
                  <span style={{
                    fontSize: '9px', fontWeight: 700, color: '#94a3b8', background: '#f1f5f9',
                    border: '1px solid #e2e8f0', borderRadius: '3px', padding: '2px 6px', flexShrink: 0,
                  }}>CTX {i + 1}</span>
                  <span style={{
                    fontSize: '11px', color: '#64748b', fontFamily: 'ui-monospace, monospace',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {ctx || '— — — — — — — — — — — —'}
                  </span>
                </div>
              )
            })
          })()}
        </div>

        {/* Call header */}
        <div style={{ marginBottom: '6px' }}>
          <span style={{
            fontSize: '10px', fontWeight: 700, color: '#94a3b8',
            letterSpacing: '0.07em', textTransform: 'uppercase' as const,
          }}>
            evaluating
          </span>
          <div style={{ marginTop: '3px', display: 'flex', alignItems: 'baseline', gap: '5px', fontFamily: 'ui-monospace, monospace' }}>
            <span style={{ fontSize: '14px', fontWeight: 700, color: '#0f172a' }}>{display?.def.tool ?? '—'}</span>
            <span style={{ fontSize: '12px', color: '#94a3b8' }}>({display?.def.params ?? ''})</span>
          </div>
        </div>

        {/* 3 check step slots — always rendered for stable panel height */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {[0, 1, 2].map(i => {
            const step  = display?.def.steps[i]
            const shown = display != null && (display.steps ?? 0) > i
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', visibility: shown ? 'visible' : 'hidden' }}>
                <span style={{
                  fontSize: '9px', fontWeight: 700, letterSpacing: '0.06em',
                  color:      step?.pass ? '#16a34a' : '#dc2626',
                  background: step?.pass ? '#f0fdf4' : '#fef2f2',
                  border:     `1px solid ${step?.pass ? '#bbf7d0' : '#fecaca'}`,
                  borderRadius: '3px', padding: '2px 6px', flexShrink: 0,
                }}>
                  {(step?.check ?? 'CHECK').toUpperCase()}
                </span>
                <span style={{ fontSize: '12px', fontWeight: 500, color: step?.pass ? '#15803d' : '#dc2626' }}>
                  {step?.result ?? '—'}
                </span>
              </div>
            )
          })}
        </div>

        {/* Verdict row */}
        <div style={{
          marginTop: '7px', paddingTop: '7px', borderTop: '1px solid #f1f5f9',
          display: 'flex', alignItems: 'flex-start', gap: '8px',
          visibility: display?.verdict ? 'visible' : 'hidden',
        }}>
          <VerdictChip verdict={display?.def.verdict ?? 'allowed'} />
          <span style={{ fontSize: '12px', color: '#64748b', flex: 1 }}>
            → {display?.def.outcome ?? ''}
          </span>
        </div>

        {/* Terminus row */}
        <div style={{
          marginTop: '6px', paddingTop: '6px', borderTop: '1px dashed #f1f5f9',
          display: 'flex', alignItems: 'flex-start', gap: '8px',
          visibility: display?.terminus ? 'visible' : 'hidden',
        }}>
          <span style={{
            fontSize: '9px', fontWeight: 700, letterSpacing: '0.06em',
            color: termCfg.color, background: termCfg.bg, border: `1px solid ${termCfg.border}`,
            borderRadius: '3px', padding: '2px 6px', flexShrink: 0, marginTop: '1px',
          }}>
            {termCfg.label}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <span style={{
              fontSize: '11px', fontWeight: 600, color: termCfg.color,
              fontFamily: 'ui-monospace, monospace',
            }}>
              {display?.def.terminus.kind === 'envelope' ? 'terminus:' : 'node activates:'} {display?.def.terminus.node ?? ''}
            </span>
            <div style={{
              fontSize: '12px', color: '#334155', marginTop: '2px',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {display?.def.terminus.emits ?? ''}
            </div>
          </div>
        </div>
      </div>

      {/* ── History + stats ── */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div style={{
          flex: 1, minHeight: 0, overflow: 'hidden',
          background: '#fff', border: '1px solid #e2e8f0', borderRadius: '10px',
          display: 'flex', flexDirection: 'column',
        }}>
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 76px',
            padding: '6px 14px', borderBottom: '1px solid #f1f5f9',
            background: '#f8fafc', flexShrink: 0,
          }}>
            {['Tool call · outcome', 'Verdict'].map(h => (
              <span key={h} style={{
                fontSize: '10px', fontWeight: 700, color: '#94a3b8',
                letterSpacing: '0.07em', textTransform: 'uppercase' as const,
              }}>
                {h}
              </span>
            ))}
          </div>

          <div style={{ flex: 1, overflowY: 'scroll' }}>
            {active && (
              <div style={{
                display: 'grid', gridTemplateColumns: '1fr 76px',
                gap: '8px', padding: '6px 14px',
                borderBottom: '1px solid #f1f5f9', alignItems: 'start',
                background: '#fafbff',
              }}>
                <div style={{ minWidth: 0 }}>
                  <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '12px', fontWeight: 600, color: '#334155' }}>
                    {active.contextNew && <span style={{ color: '#b45309', marginRight: '4px' }}>↺</span>}
                    {active.def.tool}
                  </span>
                  <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '11px', color: '#94a3b8', marginLeft: '4px' }}>
                    ({active.def.params})
                  </span>
                  <div style={{
                    fontSize: '11px', color: '#94a3b8', marginTop: '1px',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {active.verdict ? `→ ${active.def.outcome}` : '…evaluating'}
                  </div>
                </div>
                {active.verdict
                  ? <VerdictChip verdict={active.def.verdict} />
                  : <span style={{ fontSize: '11px', color: '#cbd5e1' }}>…</span>
                }
              </div>
            )}

            {history.length === 0 && !active && (
              <div style={{ padding: '24px', textAlign: 'center', fontSize: '12px', color: '#cbd5e1' }}>
                Call history will appear here
              </div>
            )}

            {history.map(call => (
              <div key={call.hid} style={{
                display: 'grid', gridTemplateColumns: '1fr 76px',
                gap: '8px', padding: '6px 14px',
                borderBottom: '1px solid #f8fafc', alignItems: 'start',
              }}>
                <div style={{ minWidth: 0 }}>
                  <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '12px', fontWeight: 600, color: '#334155' }}>
                    {call.isReeval && <span style={{ color: '#b45309', marginRight: '4px' }}>↺</span>}
                    {call.tool}
                  </span>
                  <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '11px', color: '#94a3b8', marginLeft: '4px' }}>
                    ({call.params})
                  </span>
                  <div style={{
                    fontSize: '11px', color: '#94a3b8', marginTop: '1px',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    → {call.outcome}
                  </div>
                </div>
                <VerdictChip verdict={call.verdict} />
              </div>
            ))}
          </div>
        </div>

        {/* Stats bar */}
        <div style={{
          flexShrink: 0, display: 'flex', alignItems: 'stretch',
          background: '#fff', border: '1px solid #e2e8f0', borderRadius: '10px',
          overflow: 'hidden',
        }}>
          <StatBlock value={stats.allowed}   label="Allowed"          color="#16a34a" />
          <div style={{ width: '1px', background: '#e2e8f0' }} />
          <StatBlock value={stats.confirm}   label="Awaiting confirm" color="#d97706" />
          <div style={{ width: '1px', background: '#e2e8f0' }} />
          <StatBlock value={stats.exception} label="Re-evaluated"     color="#b45309" />
          <div style={{ width: '1px', background: '#e2e8f0' }} />
          <StatBlock value={stats.blocked}   label="Blocked"          color="#dc2626" />
          <div style={{ width: '1px', background: '#e2e8f0' }} />
          <div style={{ flex: 1, padding: '9px 16px', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '5px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span style={{ fontSize: '11px', color: '#94a3b8' }}>
                {total > 0
                  ? `${stats.blocked} of ${total} calls structurally prevented`
                  : 'Waiting for tool calls…'}
              </span>
              <span style={{ fontSize: '20px', fontWeight: 700, color: '#dc2626', fontVariantNumeric: 'tabular-nums' }}>
                {total > 0 ? `${Math.round((stats.blocked / total) * 100)}%` : '—'}
              </span>
            </div>
            <div style={{ height: '5px', borderRadius: '3px', background: '#f1f5f9', overflow: 'hidden' }}>
              <div style={{
                height: '100%', borderRadius: '3px',
                width: total > 0 ? `${Math.round(((stats.allowed + stats.confirm) / total) * 100)}%` : '0%',
                background: 'linear-gradient(to right, #16a34a, #22c55e)',
                transition: 'width 0.6s ease',
              }} />
            </div>
            <div style={{ fontSize: '10px', color: '#94a3b8' }}>
              allowed + awaiting confirm (green) vs structurally blocked (red remainder)
            </div>
          </div>
        </div>
      </div>

    </div>
  )
}

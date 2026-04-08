import { useState, useEffect, useRef } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────

type Verdict = 'allowed' | 'blocked' | 'confirm'

interface CallDef {
  tool:       string
  params:     string
  permission: string
  verdict:    Verdict
  reason:     string
  route:      string   // what happens after
}

interface CallEntry extends CallDef {
  id:    number
  state: 'evaluating' | 'resolved'
}

// ── Tool call sequence ────────────────────────────────────────────────────────

const CALLS: CallDef[] = [
  {
    tool: 'engram.query',
    params: '"auth timeout pattern"',
    permission: 'None',
    verdict: 'allowed',
    reason: 'Public read — no permission required',
    route: 'returns path: CheckConnectionPool [confidence: 0.91]',
  },
  {
    tool: 'DeleteUser',
    params: 'account_id=42',
    permission: 'Admin',
    verdict: 'blocked',
    reason: 'Session permission: Authenticated — insufficient',
    route: 'graph activates: permission_denied → re-auth question',
  },
  {
    tool: 'CheckLineStatus',
    params: 'postcode="BT1 4AB"',
    permission: 'None',
    verdict: 'allowed',
    reason: 'Read-only diagnostic — no permission required',
    route: 'returns: line_status=degraded, latency=420ms',
  },
  {
    tool: 'CancelService',
    params: 'account_id=42, reason="non-payment"',
    permission: 'Authenticated',
    verdict: 'confirm',
    reason: 'Destructive — explicit confirmation required',
    route: 'breaking question: "Confirm cancellation for account 42?"',
  },
  {
    tool: 'engram.confirm',
    params: 'session_id="2026-04-01-007", outcome=resolved',
    permission: 'None',
    verdict: 'allowed',
    reason: 'Session feedback — always permitted',
    route: 'edge weights updated: CheckConnectionPool +0.03',
  },
  {
    tool: 'DropDatabase',
    params: 'name="production"',
    permission: 'Admin',
    verdict: 'blocked',
    reason: 'Action not in contract — not enumerable',
    route: 'graph activates: unknown_action → escalation node',
  },
  {
    tool: 'RebootRouter',
    params: 'device_id="RTR-0042"',
    permission: 'Verified',
    verdict: 'allowed',
    reason: 'Verified session — rate limit: 3/hour (1 used)',
    route: 'action dispatched to execution layer',
  },
  {
    tool: 'ScheduleEngineer',
    params: 'slot="2026-04-08T09:00", account_id=42',
    permission: 'Verified',
    verdict: 'confirm',
    reason: 'Confirmation required — rollback available',
    route: 'breaking question: "Confirm engineer visit for 09:00?"',
  },
  {
    tool: 'ExportUserData',
    params: 'account_id=42, format="csv"',
    permission: 'Admin',
    verdict: 'blocked',
    reason: 'Session permission: Verified — insufficient',
    route: 'graph activates: permission_denied → escalation',
  },
  {
    tool: 'engram.query',
    params: '"OOM kill pattern"',
    permission: 'None',
    verdict: 'allowed',
    reason: 'Public read — no permission required',
    route: 'returns path: IncreaseMemoryLimit [confidence: 0.84]',
  },
]

const EVAL_MS  = 600
const DELAY_MS = 1400

// ── Small components ──────────────────────────────────────────────────────────

function VerdictChip({ verdict }: { verdict: Verdict }) {
  const map = {
    allowed: { label: '✓ Allowed', color: '#16a34a', bg: '#f0fdf4', border: '#bbf7d0' },
    blocked: { label: '✕ Blocked', color: '#dc2626', bg: '#fef2f2', border: '#fecaca' },
    confirm: { label: '? Confirm', color: '#d97706', bg: '#fffbeb', border: '#fde68a' },
  }
  const s = map[verdict]
  return (
    <span style={{
      fontSize: '11px', fontWeight: 600, color: s.color,
      background: s.bg, border: `1px solid ${s.border}`,
      borderRadius: '20px', padding: '1px 8px', whiteSpace: 'nowrap',
    }}>
      {s.label}
    </span>
  )
}

function CallRow({ entry }: { entry: CallEntry }) {
  const done = entry.state === 'resolved'
  return (
    <div style={{
      padding: '7px 14px', borderBottom: '1px solid #f8fafc',
      animation: 'rowIn 0.2s ease both',
    }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px 90px', alignItems: 'start', gap: '8px' }}>
        <div style={{ minWidth: 0 }}>
          <span style={{
            fontSize: '12px', fontFamily: 'ui-monospace, monospace',
            color: '#334155', fontWeight: 600,
          }}>
            {entry.tool}
          </span>
          <span style={{
            fontSize: '11px', fontFamily: 'ui-monospace, monospace',
            color: '#94a3b8', marginLeft: '4px',
          }}>
            ({entry.params})
          </span>
        </div>
        <div style={{ paddingTop: '1px' }}>
          {done
            ? <VerdictChip verdict={entry.verdict} />
            : <span style={{ fontSize: '11px', color: '#cbd5e1' }}>evaluating…</span>
          }
        </div>
        <div style={{
          fontSize: '10px', color: '#94a3b8', paddingTop: '2px',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {done ? `req: ${entry.permission}` : ''}
        </div>
      </div>
      {done && (
        <div style={{ marginTop: '4px', display: 'flex', flexDirection: 'column', gap: '1px', animation: 'fadeIn 0.3s ease both' }}>
          <div style={{ fontSize: '11px', color: '#64748b' }}>
            <span style={{ color: '#94a3b8' }}>policy: </span>{entry.reason}
          </div>
          <div style={{ fontSize: '11px', color: '#94a3b8' }}>
            <span style={{ color: '#94a3b8' }}>→ </span>{entry.route}
          </div>
        </div>
      )}
    </div>
  )
}

function StatBlock({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <div style={{ padding: '10px 20px', minWidth: '100px' }}>
      <div style={{ fontSize: '24px', fontWeight: 700, color, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
        {value}
      </div>
      <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '3px' }}>{label}</div>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function LLMToolGateway() {
  const [entries, setEntries]   = useState<CallEntry[]>([])
  const [stats, setStats]       = useState({ allowed: 0, blocked: 0, confirm: 0 })
  const timers    = useRef<ReturnType<typeof setTimeout>[]>([])
  const idRef     = useRef(0)
  const scrollRef = useRef<HTMLDivElement>(null)

  function clearAll() { timers.current.forEach(clearTimeout); timers.current = [] }

  function fire(def: CallDef) {
    const id = idRef.current++
    setEntries(prev => [...prev.slice(-9), { id, ...def, state: 'evaluating' }])
    const t = setTimeout(() => {
      setEntries(prev => prev.map(e => e.id === id ? { ...e, state: 'resolved' } : e))
      setStats(prev => ({ ...prev, [def.verdict]: prev[def.verdict] + 1 }))
    }, EVAL_MS)
    timers.current.push(t)
  }

  function runLoop() {
    CALLS.forEach((c, i) => {
      const t = setTimeout(() => fire(c), i * DELAY_MS)
      timers.current.push(t)
    })
    const t = setTimeout(runLoop, CALLS.length * DELAY_MS + 2000)
    timers.current.push(t)
  }

  useEffect(() => {
    const t = setTimeout(runLoop, 400)
    timers.current.push(t)
    return clearAll
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [entries.length])

  const total = stats.allowed + stats.blocked + stats.confirm

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: '14px 20px', gap: '10px' }}>

      {/* Panel header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div>
          <span style={{ fontSize: '13px', fontWeight: 600, color: '#0f172a' }}>
            Policy Engine — LLM Tool Calls
          </span>
          <span style={{ fontSize: '12px', color: '#94a3b8', marginLeft: '10px' }}>
            every call evaluated before execution
          </span>
        </div>
        <div style={{ display: 'flex', gap: '6px' }}>
          <span style={{ fontSize: '11px', fontWeight: 600, color: '#16a34a', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '20px', padding: '3px 10px' }}>✓ Allowed</span>
          <span style={{ fontSize: '11px', fontWeight: 600, color: '#d97706', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '20px', padding: '3px 10px' }}>? Confirm</span>
          <span style={{ fontSize: '11px', fontWeight: 600, color: '#dc2626', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '20px', padding: '3px 10px' }}>✕ Blocked</span>
        </div>
      </div>

      {/* Call feed */}
      <div style={{
        flex: 1, minHeight: 0, overflow: 'hidden',
        background: '#fff', border: '1px solid #e2e8f0', borderRadius: '10px',
        display: 'flex', flexDirection: 'column',
      }}>
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 100px 90px', gap: '8px',
          padding: '7px 14px', borderBottom: '1px solid #f1f5f9',
          background: '#f8fafc', flexShrink: 0,
        }}>
          {['Tool call', 'Verdict', 'Permission'].map(h => (
            <span key={h} style={{ fontSize: '10px', fontWeight: 700, color: '#94a3b8', letterSpacing: '0.07em', textTransform: 'uppercase' }}>
              {h}
            </span>
          ))}
        </div>
        <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto' }}>
          {entries.length === 0 && (
            <div style={{ padding: '32px', textAlign: 'center', fontSize: '12px', color: '#cbd5e1' }}>Starting…</div>
          )}
          {entries.map(e => <CallRow key={e.id} entry={e} />)}
        </div>
      </div>

      {/* Stats bar */}
      <div style={{
        flexShrink: 0, display: 'flex', alignItems: 'stretch',
        background: '#fff', border: '1px solid #e2e8f0', borderRadius: '10px',
        overflow: 'hidden',
      }}>
        <StatBlock value={stats.allowed} label="Allowed" color="#16a34a" />
        <div style={{ width: '1px', background: '#e2e8f0' }} />
        <StatBlock value={stats.confirm} label="Awaiting confirm" color="#d97706" />
        <div style={{ width: '1px', background: '#e2e8f0' }} />
        <StatBlock value={stats.blocked} label="Blocked" color="#dc2626" />
        <div style={{ width: '1px', background: '#e2e8f0' }} />
        <div style={{ flex: 1, padding: '10px 20px', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '5px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span style={{ fontSize: '11px', color: '#94a3b8' }}>
              {total > 0
                ? `${stats.blocked} of ${total} calls structurally prevented`
                : 'Waiting for tool calls…'}
            </span>
            <span style={{ fontSize: '22px', fontWeight: 700, color: '#dc2626', fontVariantNumeric: 'tabular-nums' }}>
              {total > 0 ? `${Math.round((stats.blocked / total) * 100)}%` : '—'}
            </span>
          </div>
          <div style={{ height: '6px', borderRadius: '3px', background: '#f1f5f9', overflow: 'hidden' }}>
            <div style={{
              height: '100%', borderRadius: '3px',
              width: total > 0 ? `${Math.round(((stats.allowed + stats.confirm) / total) * 100)}%` : '0%',
              background: 'linear-gradient(to right, #16a34a, #22c55e)',
              transition: 'width 0.6s ease',
            }} />
          </div>
          <div style={{ fontSize: '10px', color: '#94a3b8' }}>
            actions allowed through (green) vs blocked (red portion)
          </div>
        </div>
      </div>
    </div>
  )
}

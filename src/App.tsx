import { useState, useRef } from 'react'
import LLMCostFilter from './simulations/LLMCostFilter'
import PrivacyByArchitecture from './simulations/PrivacyByArchitecture'
import MCPAgentMemory from './simulations/MCPAgentMemory'
import GraphLearns from './simulations/GraphLearns'

// ── Types ─────────────────────────────────────────────────────────────────────

type TabId = 'llm-cost' | 'privacy' | 'mcp' | 'learning'

const TABS: { id: TabId; label: string; tagline: string }[] = [
  { id: 'llm-cost', label: 'LLM Cost Filter',        tagline: 'Handle the majority of queries without touching the API.' },
  { id: 'privacy',  label: 'Privacy by Architecture', tagline: 'The attribution is structurally absent — not scrubbed, never recorded.' },
  { id: 'mcp',      label: 'MCP Agent Memory',        tagline: 'Give your LLM agent a persistent, self-improving knowledge base.' },
  { id: 'learning', label: 'Graph Learns',            tagline: 'Every session makes the next one cheaper. No retraining required.' },
]

// ── Content ───────────────────────────────────────────────────────────────────

const WHAT_ENGRAM_IS = [
  {
    requirement: 'Same input → guaranteed same output',
    llm: 'No — stochastic by design',
    engram: 'Yes — deterministic graph traversal',
  },
  {
    requirement: 'Full reasoning trace, auditable to each step',
    llm: 'No',
    engram: 'Yes — every node and edge is named',
  },
  {
    requirement: 'Runs fully offline, no runtime dependency',
    llm: 'Needs runtime / server',
    engram: 'Yes — single binary, no network',
  },
  {
    requirement: 'Improves from session feedback without retraining',
    llm: 'No — requires new fine-tune',
    engram: 'Yes — edge weights update in real time',
  },
  {
    requirement: 'Stores patterns, never raw content',
    llm: 'Depends on deployment',
    engram: 'Structural — raw data never exists in transmittable form',
  },
  {
    requirement: 'Domain knowledge independently ownable per team',
    llm: 'No — entangled in weights',
    engram: 'Yes — separate graph files, swappable',
  },
]

const FEATURES = [
  {
    icon: '≡',
    title: 'Deterministic',
    desc: 'Same input always produces the same reasoning path. Not stochastic — guaranteed.',
  },
  {
    icon: '◎',
    title: 'Explainable',
    desc: 'Every answer shows exactly which nodes and edges led to it. Full trace, every step.',
  },
  {
    icon: '⊘',
    title: 'Offline-first',
    desc: 'Single binary, no network, no API key, no model server. Runs air-gapped.',
  },
  {
    icon: '↑',
    title: 'Incremental learning',
    desc: 'Session feedback updates edge weights in real time. No retraining cycle, no labelled dataset.',
  },
  {
    icon: '🔒',
    title: 'Privacy by architecture',
    desc: 'Raw text is discarded at the tokeniser. Downstream storage holds only node IDs — structurally, not by policy.',
  },
  {
    icon: '⊞',
    title: 'Composable',
    desc: 'Domain knowledge lives in separate graph files. Load, swap, or version them independently.',
  },
  {
    icon: '⚡',
    title: 'Action-first',
    desc: 'Solution nodes carry typed action contracts. The execution layer is completely separate.',
  },
  {
    icon: '→',
    title: 'Escalation-ready',
    desc: 'Structured handoff payload exported when confidence falls below threshold. The LLM sees context, not conversation.',
  },
]

const PHASES = [
  { n: 1,  label: 'Static keyword lookup from seed knowledge graph',            done: true  },
  { n: 2,  label: 'Graph activation and propagation with confidence trace',     done: false },
  { n: 3,  label: 'Single yes/no clarification',                               done: false },
  { n: 4,  label: 'Multi-branch breaking questions',                           done: false },
  { n: 5,  label: 'Named path recording with tags',                            done: false },
  { n: 6,  label: 'Path-level cache for fast re-resolution',                   done: false },
  { n: 7,  label: 'Session recording — full audit trail',                      done: false },
  { n: 8,  label: 'Reinforcement learning — weights evolve from sessions',     done: false },
  { n: 9,  label: 'Weak answer memory',                                        done: false },
  { n: 10, label: 'Latent node discovery',                                     done: false },
  { n: 11, label: 'Automatic context expansion',                               done: false },
  { n: 12, label: 'Bias tuning and exploration noise',                         done: false },
  { n: 13, label: 'BM25 retrieval, n-grams, session context carry-forward, composite answers', done: false },
  { n: 14, label: 'Connectome Inspector — visual graph explorer',              done: false },
]

// ── Small components ──────────────────────────────────────────────────────────

function FeatureCard({ icon, title, desc }: { icon: string; title: string; desc: string }) {
  return (
    <div style={{
      background: '#fff', border: '1px solid #e2e8f0', borderRadius: '10px',
      padding: '16px', display: 'flex', flexDirection: 'column', gap: '6px',
    }}>
      <div style={{ fontSize: '18px', lineHeight: 1 }}>{icon}</div>
      <div style={{ fontSize: '13px', fontWeight: 600, color: '#0f172a' }}>{title}</div>
      <div style={{ fontSize: '12px', color: '#64748b', lineHeight: 1.55 }}>{desc}</div>
    </div>
  )
}

function Tag({ label, color, bg }: { label: string; color: string; bg: string }) {
  return (
    <span style={{
      fontSize: '11px', fontWeight: 600, color, background: bg,
      border: `1px solid ${color}30`, borderRadius: '20px', padding: '3px 10px',
    }}>
      {label}
    </span>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [tab, setTab]           = useState<TabId>('llm-cost')
  const [displayTab, setDisplayTab] = useState<TabId>('llm-cost')
  const [opacity, setOpacity]   = useState(1)
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function switchTab(id: TabId) {
    if (id === tab) return
    if (fadeTimer.current) clearTimeout(fadeTimer.current)
    setOpacity(0)
    setTab(id)
    fadeTimer.current = setTimeout(() => { setDisplayTab(id); setOpacity(1) }, 200)
  }

  const currentTab = TABS.find(t => t.id === tab)!

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif' }}>

      {/* ── Sticky header ── */}
      <header style={{
        position: 'sticky', top: 0, zIndex: 20,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 32px', height: '52px',
        background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(8px)',
        borderBottom: '1px solid #e2e8f0',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '15px', fontWeight: 700, color: '#0f172a', letterSpacing: '-0.02em' }}>
            Engram
          </span>
          <span style={{
            fontSize: '10px', fontWeight: 600, color: '#7c3aed',
            background: '#faf5ff', border: '1px solid #ddd6fe',
            borderRadius: '4px', padding: '2px 6px', letterSpacing: '0.04em',
          }}>
            DEMO
          </span>
        </div>
        <nav style={{ display: 'flex', gap: '24px', alignItems: 'center' }}>
          <a href="#simulations" style={{ fontSize: '13px', color: '#64748b', textDecoration: 'none', fontWeight: 500 }}>
            Demos
          </a>
          <a href="#deployment" style={{ fontSize: '13px', color: '#64748b', textDecoration: 'none', fontWeight: 500 }}>
            Deployment
          </a>
          <a href="#features" style={{ fontSize: '13px', color: '#64748b', textDecoration: 'none', fontWeight: 500 }}>
            Features
          </a>
          <a
            href="https://github.com/dominikj111/Engram"
            target="_blank" rel="noopener noreferrer"
            style={{ fontSize: '13px', color: '#64748b', textDecoration: 'none', fontWeight: 500 }}
          >
            GitHub
          </a>
          <a
            href="https://github.com/dominikj111/Engram/tree/main/docs"
            target="_blank" rel="noopener noreferrer"
            style={{
              fontSize: '13px', fontWeight: 600, color: '#fff',
              background: '#0f172a', border: '1px solid #0f172a',
              borderRadius: '7px', padding: '5px 14px', textDecoration: 'none',
            }}
          >
            Docs
          </a>
        </nav>
      </header>

      {/* ── Hero ── */}
      <section style={{ maxWidth: '860px', margin: '0 auto', padding: '72px 32px 56px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
          <Tag label="Phase 1 complete" color="#16a34a" bg="#f0fdf4" />
          <Tag label="Rust" color="#ea580c" bg="#fff7ed" />
          <Tag label="Apache 2.0" color="#0369a1" bg="#f0f9ff" />
        </div>

        <h1 style={{ fontSize: '52px', fontWeight: 700, color: '#0f172a', letterSpacing: '-0.03em', margin: '0 0 12px', lineHeight: 1.05 }}>
          Engram
        </h1>
        <p style={{ fontSize: '22px', fontWeight: 500, color: '#334155', margin: '0 0 20px', letterSpacing: '-0.01em', lineHeight: 1.3 }}>
          A deterministic reasoning kernel — symbolic AI with configurable boundaries and fluid internals.
        </p>
        <p style={{ fontSize: '16px', color: '#64748b', margin: '0 0 16px', lineHeight: 1.65, maxWidth: '680px' }}>
          Given a context, Engram navigates a directed graph of concepts, asks targeted{' '}
          <strong style={{ color: '#334155' }}>breaking questions</strong> to resolve ambiguity, and emits
          typed <strong style={{ color: '#334155' }}>action contracts</strong> that a separate execution layer runs.
          Every path is auditable, every weight is named, and the system improves without retraining.
        </p>
        <p style={{ fontSize: '16px', color: '#64748b', margin: 0, lineHeight: 1.65, maxWidth: '680px' }}>
          The boundaries are independently configurable: context nodes and actions can be{' '}
          <strong style={{ color: '#334155' }}>locked</strong> for fully frozen, auditable inference, or{' '}
          <strong style={{ color: '#334155' }}>opened</strong> to allow runtime knowledge additions — letting an LLM
          author nodes into the graph so that future similar queries resolve from the graph directly, without an API call.
          Built for bounded, high-stakes domains where determinism and auditability matter:
          LLM agent meshes, medical triage routing, CI/CD fault isolation, offline industrial agents.
        </p>
      </section>

      {/* ── What Engram is — comparison table ── */}
      <section style={{ maxWidth: '860px', margin: '0 auto', padding: '0 32px 72px' }}>
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '10px', overflow: 'hidden' }}>
          {/* Header row */}
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 200px 200px',
            padding: '9px 16px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0',
          }}>
            <span style={{ fontSize: '11px', fontWeight: 700, color: '#94a3b8', letterSpacing: '0.07em', textTransform: 'uppercase' }}>Requirement</span>
            <span style={{ fontSize: '11px', fontWeight: 700, color: '#94a3b8', letterSpacing: '0.07em', textTransform: 'uppercase' }}>Small LLM / fine-tuned model</span>
            <span style={{ fontSize: '11px', fontWeight: 700, color: '#16a34a', letterSpacing: '0.07em', textTransform: 'uppercase' }}>Engram</span>
          </div>
          {WHAT_ENGRAM_IS.map((row, i) => (
            <div key={row.requirement} style={{
              display: 'grid', gridTemplateColumns: '1fr 200px 200px',
              padding: '10px 16px', borderBottom: i < WHAT_ENGRAM_IS.length - 1 ? '1px solid #f1f5f9' : undefined,
              alignItems: 'start',
            }}>
              <span style={{ fontSize: '13px', color: '#0f172a', paddingRight: '16px' }}>{row.requirement}</span>
              <span style={{ fontSize: '12px', color: '#94a3b8', paddingRight: '12px' }}>{row.llm}</span>
              <span style={{ fontSize: '12px', color: '#15803d', fontWeight: 500 }}>{row.engram}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ── Deployment configuration ── */}
      <section id="deployment" style={{ maxWidth: '860px', margin: '0 auto', padding: '0 32px 72px' }}>
        <h2 style={{ fontSize: '24px', fontWeight: 700, color: '#0f172a', margin: '0 0 6px', letterSpacing: '-0.02em' }}>
          Deployment configuration
        </h2>
        <p style={{ fontSize: '14px', color: '#64748b', margin: '0 0 20px' }}>
          Four independently lockable axes give 16 deployment configurations — from pure frozen inference to a
          fully adaptive LLM memory artifact. Each axis is a flag in the deployment config, not an architectural choice.
        </p>

        {/* Four axes */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', marginBottom: '16px' }}>
          {[
            {
              axis: 'Context nodes',
              locked: 'Fixed domain — no new concepts at runtime',
              open: 'LLM or operator can add nodes; enter provisional state until confirmed',
            },
            {
              axis: 'Actions',
              locked: 'Action set is frozen — only authored contracts can fire',
              open: 'New action contracts can be registered at runtime',
            },
            {
              axis: 'Graph learning',
              locked: 'Edge weights are static — pure inference, fully versioned',
              open: 'Weights update in real time from confirmed session outcomes',
            },
            {
              axis: 'Input mode',
              locked: 'Constrained — breaking questions accept only listed branch choices',
              open: 'Open — free text, pasted logs, stack traces all tokenised as context',
            },
          ].map(a => (
            <div key={a.axis} style={{
              background: '#fff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '14px',
            }}>
              <div style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', marginBottom: '10px' }}>{a.axis}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'flex-start' }}>
                  <span style={{
                    fontSize: '9px', fontWeight: 700, color: '#64748b', background: '#f1f5f9',
                    border: '1px solid #e2e8f0', borderRadius: '3px', padding: '2px 5px',
                    flexShrink: 0, marginTop: '1px', letterSpacing: '0.04em',
                  }}>LOCKED</span>
                  <span style={{ fontSize: '11px', color: '#64748b', lineHeight: 1.4 }}>{a.locked}</span>
                </div>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'flex-start' }}>
                  <span style={{
                    fontSize: '9px', fontWeight: 700, color: '#16a34a', background: '#f0fdf4',
                    border: '1px solid #bbf7d0', borderRadius: '3px', padding: '2px 5px',
                    flexShrink: 0, marginTop: '1px', letterSpacing: '0.04em',
                  }}>OPEN</span>
                  <span style={{ fontSize: '11px', color: '#334155', lineHeight: 1.4 }}>{a.open}</span>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Representative configurations table */}
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '10px', overflow: 'hidden' }}>
          <div style={{
            display: 'grid', gridTemplateColumns: '80px 80px 100px 100px 1fr',
            padding: '8px 14px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0',
          }}>
            {['Context', 'Actions', 'Graph', 'Input', 'Natural use case'].map(h => (
              <span key={h} style={{ fontSize: '10px', fontWeight: 700, color: '#94a3b8', letterSpacing: '0.07em', textTransform: 'uppercase' }}>{h}</span>
            ))}
          </div>
          {[
            { ctx: 'Locked', act: 'Locked', graph: 'Locked',    input: 'Constrained', use: 'Compliance routing, regulated environments, voice — fully auditable, controlled UX' },
            { ctx: 'Locked', act: 'Locked', graph: 'Locked',    input: 'Open',        use: 'CLI tools, technical diagnostics — pure inference, developer-friendly' },
            { ctx: 'Locked', act: 'Locked', graph: 'Learning',  input: 'Open',        use: 'On-call tooling, developer assistants — stable domain, self-optimising' },
            { ctx: 'Open',   act: 'Locked', graph: 'Learning',  input: 'Open',        use: 'LLM-assisted knowledge distillation — LLM extends vocabulary, paths self-optimise' },
            { ctx: 'Open',   act: 'Open',   graph: 'Learning',  input: 'Open',        use: 'Fully adaptive — LLM teaches graph at every layer; produces a shareable, versioned memory artifact' },
          ].map((row, i, arr) => (
            <div key={i} style={{
              display: 'grid', gridTemplateColumns: '80px 80px 100px 100px 1fr',
              padding: '9px 14px', borderBottom: i < arr.length - 1 ? '1px solid #f1f5f9' : undefined,
              alignItems: 'start',
              background: i === arr.length - 1 ? '#f0fdf408' : undefined,
            }}>
              {[row.ctx, row.act, row.graph, row.input].map((val, j) => {
                const isOpen = val === 'Open' || val === 'Learning'
                return (
                  <span key={j} style={{
                    fontSize: '11px', fontWeight: 600,
                    color: isOpen ? '#15803d' : '#64748b',
                  }}>{val}</span>
                )
              })}
              <span style={{ fontSize: '12px', color: '#334155' }}>{row.use}</span>
            </div>
          ))}
        </div>
        <p style={{ fontSize: '12px', color: '#94a3b8', marginTop: '8px' }}>
          New nodes added when axes are open enter a provisional state and earn weight through independent session confirmations — the same mechanism as any other path.
          See <a href="https://github.com/dominikj111/Engram/blob/main/docs/architecture.md" target="_blank" rel="noopener noreferrer" style={{ color: '#64748b' }}>architecture.md §3.7</a> for all 16 configurations.
        </p>
      </section>

      {/* ── Simulations ── */}
      <section id="simulations" style={{ maxWidth: '1080px', margin: '0 auto', padding: '0 32px 72px' }}>
        <div style={{ marginBottom: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
            <h2 style={{ fontSize: '24px', fontWeight: 700, color: '#0f172a', margin: 0, letterSpacing: '-0.02em' }}>
              Intended behavior
            </h2>
            <span style={{
              fontSize: '10px', fontWeight: 700, color: '#ea580c',
              background: '#fff7ed', border: '1px solid #fed7aa',
              borderRadius: '4px', padding: '2px 7px', letterSpacing: '0.04em',
            }}>
              DESIGN SIMULATIONS
            </span>
          </div>
          <p style={{ fontSize: '14px', color: '#64748b', margin: 0 }}>
            These simulations show Engram's full design intent across four use cases. They are not a running implementation —
            see the roadmap below for what is built. All demos auto-play and loop.
          </p>
        </div>

        {/* Tab pills */}
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '12px' }}>
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => switchTab(t.id)}
              style={{
                padding: '5px 14px', borderRadius: '20px',
                fontSize: '13px', fontWeight: tab === t.id ? 600 : 500,
                cursor: 'pointer', fontFamily: 'inherit',
                border: tab === t.id ? '1.5px solid #0f172a' : '1.5px solid #e2e8f0',
                background: tab === t.id ? '#0f172a' : '#fff',
                color: tab === t.id ? '#fff' : '#64748b',
                transition: 'all 0.15s ease',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Simulation panel */}
        <div style={{
          height: '450px', opacity, transition: 'opacity 0.2s ease',
          border: '1px solid #e2e8f0', borderRadius: '12px',
          overflow: 'hidden', background: '#f8fafc',
        }}>
          {displayTab === 'llm-cost' && <LLMCostFilter />}
          {displayTab === 'privacy'  && <PrivacyByArchitecture />}
          {displayTab === 'mcp'      && <MCPAgentMemory />}
          {displayTab === 'learning' && <GraphLearns />}
        </div>

        <p style={{ fontSize: '12px', color: '#94a3b8', margin: '8px 0 0', fontStyle: 'italic' }}>
          {currentTab.tagline}
        </p>
      </section>

      {/* ── Feature grid ── */}
      <section id="features" style={{ maxWidth: '860px', margin: '0 auto', padding: '0 32px 72px' }}>
        <h2 style={{ fontSize: '24px', fontWeight: 700, color: '#0f172a', margin: '0 0 6px', letterSpacing: '-0.02em' }}>
          Design principles
        </h2>
        <p style={{ fontSize: '14px', color: '#64748b', margin: '0 0 24px' }}>
          Specific trade-offs that most AI tooling deliberately avoids.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px' }}>
          {FEATURES.map(f => <FeatureCard key={f.title} {...f} />)}
        </div>
      </section>

      {/* ── Prior art comparison ── */}
      <section style={{ maxWidth: '860px', margin: '0 auto', padding: '0 32px 72px' }}>
        <h2 style={{ fontSize: '24px', fontWeight: 700, color: '#0f172a', margin: '0 0 6px', letterSpacing: '-0.02em' }}>
          How it compares
        </h2>
        <p style={{ fontSize: '14px', color: '#64748b', margin: '0 0 20px' }}>
          Several systems overlap with parts of Engram. None combine all four properties.
        </p>
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '10px', overflow: 'hidden' }}>
          {[
            { system: 'Drools / RETE',           shared: 'Deterministic, auditable, typed actions',     missing: 'No dialogue layer, salience is hand-tuned not learned' },
            { system: 'Rasa',                    shared: 'Task-oriented dialogue, story graphs',         missing: 'Stores utterances, requires full retraining, not offline' },
            { system: 'Bayesian belief networks', shared: 'Weighted directed graph, deterministic inference', missing: 'No dialogue layer, no action contracts' },
            { system: 'OpenCyc / ResearchCyc',   shared: 'Closed-world knowledge graph, offline',        missing: 'No learning, no dialogue' },
            { system: 'Engram',                  shared: 'All of the above',                             missing: '—', highlight: true },
          ].map((row, i) => (
            <div key={row.system} style={{
              display: 'grid', gridTemplateColumns: '180px 1fr 1fr',
              padding: '10px 16px', borderBottom: i < 4 ? '1px solid #f1f5f9' : undefined,
              background: row.highlight ? '#f0fdf4' : undefined,
              alignItems: 'start',
            }}>
              <span style={{ fontSize: '13px', fontWeight: 600, color: row.highlight ? '#15803d' : '#0f172a' }}>
                {row.system}
              </span>
              <span style={{ fontSize: '12px', color: '#334155', paddingRight: '12px' }}>{row.shared}</span>
              <span style={{ fontSize: '12px', color: row.highlight ? '#16a34a' : '#94a3b8' }}>{row.missing}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ── Status / Roadmap ── */}
      <section style={{ maxWidth: '860px', margin: '0 auto', padding: '0 32px 72px' }}>
        <h2 style={{ fontSize: '24px', fontWeight: 700, color: '#0f172a', margin: '0 0 6px', letterSpacing: '-0.02em' }}>
          Status
        </h2>
        <p style={{ fontSize: '14px', color: '#64748b', margin: '0 0 20px' }}>
          The Rust binary is the reference implementation. The knowledge file format (JSON) and the reasoning spec are language-agnostic.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {PHASES.map(p => (
            <div key={p.n} style={{
              display: 'flex', alignItems: 'center', gap: '12px',
              padding: '10px 14px', background: '#fff',
              border: '1px solid #e2e8f0', borderRadius: '8px',
            }}>
              <div style={{
                width: '28px', height: '28px', borderRadius: '50%', flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '11px', fontWeight: 700,
                background: p.done ? '#16a34a' : '#f1f5f9',
                color: p.done ? '#fff' : '#94a3b8',
                border: p.done ? '2px solid #16a34a' : '2px solid #e2e8f0',
              }}>
                {p.done ? '✓' : p.n}
              </div>
              <span style={{ fontSize: '13px', color: p.done ? '#15803d' : '#334155', fontWeight: p.done ? 500 : 400 }}>
                {p.label}
              </span>
              {p.done && (
                <span style={{
                  marginLeft: 'auto', fontSize: '10px', fontWeight: 600, color: '#16a34a',
                  background: '#f0fdf4', border: '1px solid #bbf7d0',
                  borderRadius: '20px', padding: '2px 8px',
                }}>
                  complete
                </span>
              )}
            </div>
          ))}
        </div>
        <p style={{ fontSize: '13px', color: '#94a3b8', marginTop: '12px' }}>
          See{' '}
          <a href="https://github.com/dominikj111/Engram/blob/main/docs/roadmap.md" target="_blank" rel="noopener noreferrer" style={{ color: '#64748b' }}>
            docs/roadmap.md
          </a>
          {' '}for all 14 phases and deliverables.
        </p>
      </section>

      {/* ── Footer ── */}
      <footer style={{
        borderTop: '1px solid #e2e8f0', background: '#fff',
        padding: '24px 32px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <div style={{ fontSize: '13px', color: '#94a3b8' }}>
          Engram — Apache 2.0
        </div>
        <div style={{ display: 'flex', gap: '20px' }}>
          {[
            { label: 'GitHub', href: 'https://github.com/dominikj111/Engram' },
            { label: 'Docs', href: 'https://github.com/dominikj111/Engram/tree/main/docs' },
            { label: 'Roadmap', href: 'https://github.com/dominikj111/Engram/blob/main/docs/roadmap.md' },
            { label: 'Contributing', href: 'https://github.com/dominikj111/Engram/blob/main/CONTRIBUTING.md' },
          ].map(link => (
            <a
              key={link.label}
              href={link.href}
              target="_blank" rel="noopener noreferrer"
              style={{ fontSize: '13px', color: '#64748b', textDecoration: 'none' }}
            >
              {link.label}
            </a>
          ))}
        </div>
      </footer>
    </div>
  )
}

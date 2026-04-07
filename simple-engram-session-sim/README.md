# Engram — Interactive Session Diagram

A visual walkthrough of an Engram reasoning session. Built with React, TypeScript, and Tailwind CSS.

---

## What it shows

The diagram presents a single branching conversation that demonstrates the full Engram reasoning loop: activation, confidence scoring, breaking questions, action dispatch, reinforcement learning, and LLM handoff. It is interactive — the viewer makes the Yes/No decisions at each feedback point, causing the conversation to branch in real time.

---

## Running it

```sh
pnpm install
pnpm dev
```

Open `http://localhost:5173`.

---

## Layout

The interface has two columns:

**Left — conversation.** The session unfolds as an animated chat, one message at a time. Messages appear in sequence with short delays to make the reasoning flow readable rather than instant. The window is capped to viewport height and scrolls internally — the page itself does not grow.

**Right — legend.** A sticky panel that stays visible as the conversation grows. Each entry describes one message type — colour, label, and a one-line explanation of what it represents in the Engram architecture.

---

## Message types

Each bubble in the conversation corresponds to a distinct event in the Engram reasoning pipeline:

| Type | Colour | What it represents |
| --- | --- | --- |
| **User** | Dark slate | Input arriving at the tokeniser boundary. Text is discarded here — only node IDs propagate downstream. |
| **Processing** | Light grey | Graph activation and propagation step. Shows which nodes activated, the confidence score, and the outcome (hit / question / LLM). |
| **Bot answer** | White with border | A solution node reached with sufficient confidence. No LLM was involved. |
| **Breaking question** | Blue | The engine could not resolve ambiguity with the available context. A breaking question partitions the remaining solution space. |
| **Feedback** | Grey card | After a solution is proposed, the user confirms or rejects it. This is the signal that drives reinforcement learning. |
| **Revertable action** | Yellow | An action contract was selected and executed. Because it is revertable, it fires immediately — the user can undo it if it was wrong. |
| **Non-revertable action** | Orange | A destructive or irreversible action. The policy engine requires explicit confirmation before the execution layer runs it. |
| **Action reverted** | Light blue | The user rejected the outcome and the action was rolled back. |
| **Negative reinforcement** | Warm orange | The proposed path was wrong. Edge weights decay — this path becomes less likely to be selected next time. A weak memory entry is recorded. |
| **Positive reinforcement / learning** | Green | The proposed path was correct. Edge weights increase — this path resolves faster next time. |
| **LLM handoff** | Purple | The graph exhausted its candidates with insufficient confidence. A structured payload — tried paths, ruled-out candidates, confidence at time of escalation — is handed to an LLM or human operator. |

---

## Branching structure

The conversation has four feedback points. Each "No" triggers a new LLM/operator cycle. The fourth "No" escalates to a human operator and the simulation waits indefinitely — the operator never responds in this demo, which is the point: the dots loader communicates that the system is waiting, not broken.

```text
initialMsgs → feedback-1
  Yes → learning → done
  No  → revert → negative reinforcement
          → breaking question → new answer → feedback-2
              Yes → learning → done
              No  → negative reinforcement → LLM handoff
                      → new answer → feedback-3
                          Yes → learning → done
                          No  → revert → negative reinforcement → LLM handoff
                                  → new answer → feedback-4
                                      Yes → learning → done
                                      No  → revert → negative reinforcement
                                              → LLM handoff (escalate: human_operator)
                                              → "Handing off to a human operator…"
                                              → waiting… (dots, no further feedback)
```

The four possible outcomes:

- Direct resolution (yes at feedback-1)
- Resolution after one disambiguation (yes at feedback-2)
- Resolution after LLM loop (yes at feedback-3 or feedback-4)
- Human operator escalation — session open, waiting indefinitely

---

## What the confidence bar shows

The processing bubbles include a small coloured bar and a numeric score. The bar length and colour encode the confidence state:

- **Green** — high confidence, top candidate clear, answer returned directly
- **Blue** — ambiguous, breaking question needed to narrow the space
- **Purple** — confidence below threshold, LLM escalation

The score is the accumulated activation value after edge propagation. It is not a percentage — it is a relative ranking. What matters is the gap between the top candidate and the next: a narrow gap triggers a breaking question even if the absolute score is high.

---

## Relationship to the architecture spec

Each element in the diagram maps directly to a section of the Engram architecture:

| Diagram element | Spec section |
| --- | --- |
| Processing bubble | §4 Question Processing Pipeline |
| Confidence bar and outcome badge | §4.5 Confidence State Machine |
| Breaking question bubble | §5 Breaking Questions |
| Feedback buttons | §8 Reinforcement Learning |
| Revertable / non-revertable action | §3.6 Policy Engine |
| Learning / negative reinforcement | §9 Reinforcement Strategy |
| LLM handoff bubble | §3.4 Escalation Payload |
| Weak memory note in negative reinforcement | §11 Weak Answer Memory |
| Human operator escalation (waiting dots) | §3.4 Escalation Payload — human handoff path |

The diagram is not a simplified illustration — every event shown is a real operation the engine performs, in the order shown.

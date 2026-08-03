# Exercise 1 — Build the Agentic Loop

> Picking up from the bootstrap scaffold: the project skeleton is in place — Claude API client factory, `Budget`, `Tracer`, `ClaimSession` dataclass, package layout, tests. Your job in this exercise is the single function that drives every later turn the agent ever takes: the agentic loop.

## What You're Learning Here

An agent harness is **a loop the model controls**. On each iteration the harness does exactly one thing — sends the messages to the model — and then reads the model's `stop_reason` to decide what to do next:

- `stop_reason == "end_turn"` → the model is done. Return.
- `stop_reason == "tool_use"` → the model wants to use one or more tools. Execute them, package the results into a *single* user turn of `tool_result` blocks, and ask the model again.
- anything else (`max_tokens`, `stop_sequence`, `pause_turn`, `refusal`) → something happened we did not plan for. Raise loudly. Do not guess.

The harness owns the loop. The model owns the decision to keep going, ask for tools, or stop. The signal that crosses the boundary between them is `stop_reason`.

## Now Apply It to the Claims Intake Loop

The file `claims_intake/loop.py` already contains:

- The `FinalState` dataclass that you will return on `end_turn`.
- The `UnexpectedStopReason` exception you will raise when `stop_reason` is anything else.
- The `run(...)` signature and the entire setup: working messages, turn counter, the `while True:` header, `budget.check()`, the `client.messages.create(...)` call, and the token bookkeeping.

You will write the **body** of each iteration: build the trace record, call `tracer.write(...)`, and the three-case triage on `response.stop_reason`.

### Requirements

- The loop terminates **only** on `stop_reason == "end_turn"`.
- The loop continues **only** on `stop_reason == "tool_use"`.
- Any other `stop_reason` raises `UnexpectedStopReason` naming the turn and the offending value.
- All `tool_use` blocks in a single assistant turn are executed and returned in **one** following user turn whose `content` is a list of `tool_result` blocks (each with the matching `tool_use_id`). Not one user turn per tool.
- The trace records one JSON object per turn with these keys: `turn`, `stop_reason`, `tool_calls`, `latency_ms`, `input_tokens`, `output_tokens`.

### How This Exercises the Loop

The loop you write here is the artifact every later stage extends — context engineering, evals, bounded autonomy, multi-agent orchestration. Getting the `stop_reason`-driven control flow right now is what makes those later stages tractable.

### Resources

- Starter code: `starter/`
- Solution reference (do not peek until you have the loop running): `solution/`
- The `tests/test_loop.py` file already exists — your job is to make it pass.

### Instructions

- [ ] Open `starter/claims_intake/loop.py` and read the function signature and the existing scaffold above the TODO.
- [ ] Build the per-turn trace record (`turn`, `stop_reason`, `tool_calls`, `latency_ms`, `input_tokens`, `output_tokens`) and call `tracer.write(...)`.
- [ ] Handle the `end_turn` case: append the assistant turn to `working_messages`, return a `FinalState`.
- [ ] Handle the `tool_use` case: append the assistant turn, then for every `tool_use` block call `tool_executor(name, input)`, collect the results into matching `tool_result` blocks, append a *single* user turn containing all of them, and `continue` the loop.
- [ ] Raise `UnexpectedStopReason` for anything else.

### Verify

From inside `starter/`:

```bash
pip install -e ".[dev]"
pytest tests/test_loop.py -v
```

All 5 tests should pass. They use a scripted `FakeMessages` client, so this runs offline and costs nothing.

> Run `pytest tests/test_loop.py`, not a bare `pytest`. This project is cumulative — `tests/test_tools.py` and `tests/test_fixtures.py` are already present but belong to Exercises 2 and 3, so a bare `pytest` will show them as expected reds until you get there.

### Troubleshooting

- **`API rejects with shape error`** — you are probably returning the `tool_result` blocks in an assistant turn instead of a user turn. Check the `role` field.
- **`test_loop_handles_multiple_tool_use_blocks_in_one_turn` fails** — the test asserts that *all* `tool_result` blocks land in ONE user turn. If you appended one user turn per tool, you'll get 4 messages where the test expects 3.
- **`test_loop_raises_on_unexpected_stop_reason` fails** — make sure your fallback path raises rather than silently continuing.

### Stretch Challenges (Optional)

- Add a structured `pause_turn` handler that re-issues the request once before raising — useful for long-running tool calls in later modules.
- Extend the trace record with `model` and `system_prompt_hash` fields so traces from different prompts can be compared.

---

# Exercise 2 — Define the Tool Kit and Add the Anti-Pattern Audit

> Picking up from Exercise 1: your loop in `claims_intake/loop.py` drives a model that calls tools and returns when `stop_reason == "end_turn"`. But the tool kit is empty. Right now the model has nothing to call. This exercise gives the model its action space.

## What You're Learning Here

The tool schemas you write **are the agent's API**. The set of tools you expose is the set of actions the model can take. When the model has to choose between "ask a clarifying question" and "commit to a classification," it is choosing between two tool schemas you registered.

This has a sharp consequence: decision logic does not belong in Python. The moment your harness contains `if "water" in transcript: claim_type = "property_damage"`, you have moved the decision out of the model. That looks helpful but it is the anti-pattern that defines this module. If the model is making the decision, the harness has nothing to branch on — the model's tool choice carries it.

The four named anti-patterns in this module are how decision logic sneaks back into Python:

1. **Natural-language termination** — using `"done" in text` to decide whether to stop.
2. **Integer-literal iteration caps** — `for _ in range(10)` or `while turn < N` as the primary stop mechanism. A *Budget* (token / wall-clock, sourced from config) is the safety net; a literal cap is not.
3. **Text-content completion checks** — exiting because the response looks finished, instead of because `stop_reason == "end_turn"`.
4. **`if claim_type == "..."` branching** — Python deciding what to do based on what the model said.

An **AST audit** is how you keep them out. Static analysis on `loop.py` and the package catches these even when no test exercises the offending code path.

## Now Apply It to the Claims Intake Tool Kit

### What You'll Build

Four tool schemas the model will use to gather facts and commit to a classification:

| Tool | Purpose |
|---|---|
| `lookup_policy(policy_id)` | Returns the policy record from `data/policies.json`. |
| `record_claim_fact(field, value)` | Appends a normalized fact to the case file. |
| `classify_claim(claim_type, confidence, rationale)` | Commits the model to one of the four claim types. |
| `assess_severity(severity, rationale)` | Commits the model to `low` / `medium` / `high`. |

Plus the **Graceful Tool Failure** helpers `_err` and `_ok`, the matching dispatcher functions, and four AST tests that audit `loop.py` for the anti-patterns above.

(Exercise 3 will add `request_clarification`, `route_to_adjuster`, and `escalate_to_human`. The dispatcher stubs for those three are already in place.)

### Requirements

- All four schemas are registered in `TOOL_SCHEMAS` with `name`, `description`, and `input_schema`.
- `input_schema.required` lists every parameter the dispatcher reads.
- Categorical fields use `enum`: `claim_type` against `CLAIM_TYPES`, `severity` against `SEVERITIES`.
- Tool errors return a JSON string with shape `{"is_error": true, "error_category": "permanent"|"transient", "is_retryable": bool, "message": "..."}`. Errors are *never* raised as Python exceptions to the loop.
- Each dispatcher validates inputs and returns `_err(...)` on bad input rather than crashing.
- The four AST tests pass against `loop.py`.

### How This Exercises the Tool Kit and Anti-Pattern

The tools are the surface area through which the model can act. Writing the schemas forces you to name those actions precisely. The AST audit then closes the loop: even if someone refactors `loop.py` later and is tempted to add `if "..." in response_text:`, the audit will catch it.

### Resources

- Starter code: `starter/`
- Tool dispatcher tests: `tests/test_tools.py` (already in place; runs against what you write)

### Instructions

- [ ] In `starter/claims_intake/tools.py`, populate `TOOL_SCHEMAS` with the four schemas above.
- [ ] Implement `_err` and `_ok` so they return the right JSON shape.
- [ ] Implement `_t_lookup_policy`, `_t_record_claim_fact`, `_t_classify_claim`, `_t_assess_severity`. Each validates its input and returns a graceful error on bad input.
- [ ] In `starter/tests/test_antipatterns.py`, write the four AST tests (the file has detailed TODO comments naming the heuristic for each).

### Verify

```bash
pytest tests/test_antipatterns.py -v
pytest tests/test_tools.py::test_lookup_policy_returns_record \
       tests/test_tools.py::test_lookup_policy_unknown_id_returns_graceful_error \
       tests/test_tools.py::test_unknown_tool_returns_graceful_error \
       tests/test_tools.py::test_handler_exception_is_caught_as_transient_error -v
```

The four AST tests should pass. The four dispatcher tests above should pass. The other tests in `tests/test_tools.py` reference `request_clarification`, `route_to_adjuster`, and `escalate_to_human` — they will still fail until Exercise 3.

### Troubleshooting

- **`test_seven_tools_registered_with_schemas` fails** — that test counts 7 tools; you only have 4 after Exercise 2. Expected; it goes green at the end of Exercise 3.
- **`test_no_string_membership_against_text_in_loop` flags your own audit** — you may have used a string literal in an `in` test inside the audit itself. The audit reads `loop.py`, not its own file; double-check `PKG / "loop.py"` is the path you parse.
- **A dispatcher crashes the test rather than returning an error** — your handler raised instead of returning `_err(...)`. The dispatcher wraps handlers in `try/except`, but your own handler should prefer to return a graceful error rather than raise in the first place.

### Stretch Challenges (Optional)

- Add a fifth AST test that fails if `loop.py` imports `claim_type` from anywhere — a structural way to enforce that the loop has no domain knowledge.
- Add a description-quality lint: assert that every tool's `description` is at least 80 characters and mentions when to call it.

---

# Exercise 3 — Wire Up Clarification and Escalation, Run the Fixtures End-to-End

> Picking up from Exercise 2: your tool kit lets the model look up policies, record facts, classify claims, and assess severity — but the loop has no way to terminate (no terminal tools) and no way to ask the claimant a follow-up (no `request_clarification`). This is the exercise that turns the agent on for real.

## What You're Learning Here

There is a useful contrast that comes up everywhere in agent design. A **prompt chain** is a fixed pipeline — `extract → classify → assess → route`. It works when the steps are known in advance. Most production "agents" that fail in interesting ways are prompt chains pretending to be agents.

**Dynamic decomposition** is the alternative. The right next action depends on *what was just learned at the previous step*. Take a claim that opens with *"my basement is flooded."* A fixed pipeline has to commit to either `property_damage` or `liability` from those words alone. The agentic loop can do something a prompt chain cannot: notice the ambiguity in its own facts, emit a `request_clarification` call ("what was the source of the water?"), receive the reply, *and then* commit. The clarifying step was not in any plan. It emerged from the model inspecting its own partial state.

That is the whole pattern. Same loop. Same tool kit. The *plan* emerges from inspection.

This exercise builds the pieces that make dynamic decomposition observable:

1. `request_clarification` — the tool the model calls to ask the claimant a follow-up. The dispatcher matches the question against the fixture's scripted replies and returns the matching reply, or `"NO_RESPONSE"`.
2. `route_to_adjuster` and `escalate_to_human` — the two terminal tools. Exactly one of them runs per claim. The model picks which.
3. The system prompt — the only place the *domain* (insurance, claim types, severity buckets, the "ask once when ambiguous" rule) appears.
4. The fixture runner wiring — passes the fixture's `clarification_responses` map into the session so `request_clarification` can return scripted replies.

## Now Apply It to the Claims Intake Project

### What You'll Build

The full agent. After this exercise, running

```bash
python -m claims_intake.run --all
```

processes 8 fixture claims end-to-end. Six route to one of the four queues. One escalates to a human reviewer (because the storm-damage fixture cannot be resolved with the facts on hand). One more is ambiguous-but-resolvable and routes only after the model issues a clarification.

### Requirements

- `request_clarification`, `route_to_adjuster`, `escalate_to_human` are added to `TOOL_SCHEMAS` with valid input schemas and `enum` on categorical fields.
- The matching dispatchers (`_t_request_clarification`, `_t_route_to_adjuster`, `_t_escalate_to_human`) are implemented per the contract in `tools.py`.
- Exactly one terminal tool is called per claim. Calling both, or neither, is a graceful error.
- The system prompt directs the model to (a) look up the policy early, (b) record facts as they arrive, (c) ask one clarifying question per missing piece of information when the claim type is ambiguous, (d) commit via `classify_claim` + `assess_severity` + a terminal tool.
- The fixture runner wires `fixture["clarification_responses"]` into the session so `request_clarification` can match.
- All 8 fixtures terminate cleanly. `claim_03` routes after a clarification. `claim_06` escalates. `claim_05` routes without clarification.

### How This Exercises the Dynamic Decomposition

When you open `runs/<ts>/traces/claim_03_water_damage.jsonl` and see a `request_clarification` turn between the fact-gathering and the `classify_claim` call, you are looking at dynamic decomposition. The clarification was not in any plan. The model emitted it because it inspected its own partial state and noticed the ambiguity. Same loop. Same tool kit. Different observed behavior — driven by the facts in flight.

### Resources

- Starter code: `starter/` (your finished Exercise 2 code, plus stubs for the three new tools, the system prompt, and the runner wiring)
- Reference docs: the Anthropic Messages API tool-use docs

### Instructions

- [ ] Add the three remaining schemas to `TOOL_SCHEMAS` in `starter/claims_intake/tools.py`.
- [ ] Implement `_t_request_clarification`, `_t_route_to_adjuster`, `_t_escalate_to_human` per the TODO comments in `tools.py`.
- [ ] Write `SYSTEM_PROMPT` in `starter/claims_intake/system_prompt.py` covering the claim types, severity buckets, the clarification rule, and the terminal choice.
- [ ] In `starter/claims_intake/run.py`, wire `clarification_responses=fixture.get("clarification_responses", {})` into the `ClaimSession(...)` call.

### Verify

```bash
export ANTHROPIC_API_KEY=sk-ant-...
python -m claims_intake.run --all
pytest tests/ -v
```

`runs/<ts>/summary.md` should show 7 routed, 1 escalated. Estimated cost ≈ $0.05 on Haiku 4.5. The full pytest suite (29 tests) should be green.

### Troubleshooting

- **All claims terminate in `escalate_to_human`** — the system prompt's terminal-choice clause is probably backwards or missing. Re-read step 6 of the process: route when confidence is at least 0.6 *and* severity is set.
- **`claim_03` routes without any `request_clarification`** — either the prompt does not tell the model to ask one focused question when the claim type is ambiguous, or `ambiguity_between` is missing from the schema (the model uses that hint to decide *whether* to clarify).
- **`request_clarification` always returns `NO_RESPONSE`** — your substring matcher is comparing the question to the keys without lower-casing both sides. Look at the keys in `fixture["clarification_responses"]` — they are short keywords like `"source"`, `"locked"`, `"police"`. Match case-insensitively.
- **The model calls `route_to_adjuster` *and* `escalate_to_human`** — the dispatcher should short-circuit on `session.terminal_called` and return a graceful error.

### Stretch Challenges (Optional)

- Add a `--interactive` mode to `run.py` that takes claimant input from stdin instead of fixtures (the open question OQ-4 in the PRD).
- Cap `request_clarification` at 3 per claim via a session-level counter so the model cannot loop on clarifications. (Note: this is *not* an anti-pattern because it is a session-state guard, not a control-flow signal — the loop still exits on `stop_reason`.)

---

After this exercise, you have the working reference project. The loop, the tool kit, and the dynamic decomposition behavior are all in place. This is the pattern that later work extends.
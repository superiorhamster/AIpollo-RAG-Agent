# Behavioral scenario traceability

Owner acceptance inventory with design test tracks. This table specifies expected behavior. See [historical results](verification.md) and [open gates](handoff.md) for the separate evidence record.

| ID | Situation | Expected behavior | Track |
| --- | --- | --- | --- |
| B01 | Default or No Plan | Selected-source Ask baseline preserved; no Plan body/tagged history or suggestion; zero-source per T02 | UI/grounding |
| B02 | Select A then B then No Plan | At most one active Plan; no leakage from previous selection | UI/grounding |
| B03 | Type slash, select /plan, remove chip | Filter menu, consume command token, show duration only while Plan chip active; removing returns to Ask without losing draft | UI/grounding |
| B04 | Create Auto using prior conversation | Suitable model-selected schedule, valid saved Plan and pending objectives | Create/Edit contract |
| B05 | Create fixed 1 or 7 days | Exactly requested day coverage, validate malformed output before save | Create/Edit contract |
| B06 | Creation success | Plan appears in list, no Accept/Run; history stores request, meaningful response and Plan reference, not full Plan | Create/Edit contract |
| B07 | Ask unrelated question with active Plan | No forced alignment with Plan | UI/grounding |
| B08 | Continue or ask plan progress | Correct use of Plan context; no fake document citations | UI/grounding |
| B09 | Switch away then return to Plan | Learning history context recovered with correct version labels | History privacy |
| B10 | Mere acknowledgement vs demonstrated understanding | Null vs appropriate suggestion; assess false positives/negatives | Semantic prompt |
| B11 | Suggestion contains invalid/old/foreign/completed UUID | No unsafe suggestion/write | Transaction gates |
| B12 | Accept/dismiss completion suggestion | Only Accept changes progress; no content version bump | Transaction gates |
| B13 | Edit selected Plan and reject | Full proposal shown, current data unchanged | Create/Edit contract |
| B14 | Edit accepted content | New version, preserve untouched content/progress and IDs where practical, no second LLM call on acceptance | Create/Edit contract |
| B15 | Edit progress only | Correct progress update, no content version bump | Create/Edit contract |
| B16 | Concurrent GUI edit/progress and stale proposal | Strict revision invalidates all stale pending cards for that Plan; no silent lost update | Transaction gates |
| B17 | Old tagged turns after v1→v4 | Version-aware context; current state authoritative | History privacy |
| B18 | Window overflow / large plan / overlapping histories | Bounded prompt, explicit missing-context handling; no mislabeling | History privacy |
| B19 | GUI edit / delete | No LLM, valid data/selection/history lifecycle | Transaction gates |
| B20 | Generation failure / lack of evidence | Distinguish failed retrieval/generation from valid zero-source or empty evidence; no invalid create or mutation | Create/Edit contract |
| B21 | Create with nested suggested activities | Every objective contains generated suggested learning actions; only objectives have progress | Create/Edit contract |
| B22 | User declares prior learning or clear closure | Appropriate objective UUID without requiring proof; Accept still required | Semantic prompt |
| B23 | User postpones learning / ambiguous stop | No completion suggestion unless closure and target are clear | Semantic prompt |
| B24 | User asks whether objective is complete | Appropriate suggestion when sufficient; otherwise explanation and null | Semantic prompt |
| B25 | Suggested activities all covered but learner confused; alternative route reaches goal | Suggestions are not mandatory or sufficient completion gates | Semantic prompt |
| B26 | Edit Suggested Activities through GUI or /edit-plan | Content version on applied change; unaffected objective progress preserved; IDs best effort; /edit-plan requires Accept | Create/Edit contract |
| B27 | Model drifts from objective despite no user request; user then requests a digression | Use activity anchors to guide relevance but respect explicit user intent | UI/grounding |
| B28 | Invalid suggested sub-activity ID or stale objective | No eligible suggestion or progress write | Transaction gates |
| B29 | Select /edit-plan with active Plan / No Plan | Edit chip, no duration; submit only with valid active Plan; /edit is superseded | UI/grounding |
| B30 | Send Create request | Return composer to Ask; submitted request still routes to Create; next ordinary message uses Ask | UI/grounding |
| B31 | Send Edit request before proposal acceptance | Return composer to Ask; proposal remains independent and must still be accepted to mutate Plan | UI/grounding |
| B32 | Remove chip or failed submission | Removing returns to Ask with draft/selection intact; retry replays original request even after chip clears | UI/grounding |
| B33 | Activate Plan again after reset | Auto default; only one chip active; selected Plan remains independent | UI/grounding |
| B34 | Inspect query sent to generation and history | No raw command token injected as user query; action metadata distinguishes Create/Edit from Ask | UI/grounding |
| B35 | Successful Create generates response and Plan | Same generation produces concise explanation and full structured Plan; render both, store response and reference in history without full Plan copy | Create/Edit contract |
| B36 | Successful Edit generates response and proposal | Same generation produces proposal-language explanation and full proposed Plan; render both; no mutation before Accept | Create/Edit contract |
| B37 | Follow-up with No Plan after Create/Edit | History contains substantive assistant response without automatic full Plan injection; Ask baseline remains intact | UI/grounding |
| B38 | Follow-up before Accept or after Reject | History/context distinguishes pending and rejected proposals from applied changes; current Plan authoritative | History privacy |
| B39 | Follow-up after Accept | Context reflects accepted outcome and resulting version if content changed; progress-only acceptance does not bump version; no extra LLM call | Create/Edit contract |
| B40 | Validation/persistence failure or inconsistent summary | Do not publish misleading committed-success response or invalid Plan; propose consistency checks, failure handling and tests | Create/Edit contract |
| B41 | No Plan follow-up asks for omitted exact objectives | Use history response only; request relevant Plan selection or explicitly authorized reference, never hallucinate | UI/grounding |
| B42 | Plan A selected at submit, then B while generation runs | Request/result stays bound to A; no mutation of B | Transaction gates |
| B43 | Completion card accepted twice, then objective reopened | No duplicate write; old card cannot re-complete reopened objective | Transaction gates |
| B44 | Objective meaning changes or is removed before completion acceptance | No silent stale completion; request fresh action | Transaction gates |
| B45 | Two proposals from same base; one accepted before the other | No silent stale overwrite; only valid accepted change applied | Transaction gates |
| B46 | User ticks objective while content edit is pending | S1: invalidate proposal; preserve current progress, no merge or automatic regeneration | Transaction gates |
| B47 | Edit generation truncated, incomplete base, duplicate/foreign IDs | Do not publish/apply invalid or incomplete proposal | Create/Edit contract |
| B48 | No-op edit | No actual content/progress change: no state_revision bump; simple normalized comparison, no semantic engine | Create/Edit contract |
| B49 | Plan-only and mixed question with empty retrieval | Accurate Plan state without fake citations; factual part follows evidence policy | UI/grounding |
| B50 | History contains tagged unrelated QA and overlapping turns | No false mastery signal; deduplicate by turn identity, preserve version/outcome | History privacy |
| B51 | Create retried after uncertain acknowledgement; new deliberate Create | Same operation not duplicated; new operation creates separate Plan | Transaction gates |
| B52 | Delete or revoke access while card/proposal pending | No stale mutation, no target substitution or resurrection | Transaction gates |
| B53 | History budget drops referenced version or proposal outcome | No relabeling or presumed acceptance; mark unknown or omit dependent context | History privacy |
| B54 | Fixed N conflicts with user text or impossible coverage | Selected duration governs valid output; explain conflict/fail safely, no fabricated coverage | Create/Edit contract |
| B55 | Create with active Plan | New entity, no implicit mutation of active Plan; reference handling authorized | Create/Edit contract |
| B56 | Ordinary Ask retry with Plan | Preserve existing retry semantics and original request binding; no switch to another target or hidden mutation | Transaction gates |
| B57 | Close browser with pending completion suggestion; reopen chat | Restore persisted card and current status; interact only if valid | Transaction gates |
| B58 | Return to pending Edit Proposal in later session | Restore proposal, bound base and outcome; Accept only while valid | Transaction gates |
| B59 | Direct CRUD in Chat A workspace; Ask in Chat B same workspace | Authorized owner-private recent update available to same owner in same workspace; hidden from normal chat UI | History privacy |
| B60 | Many CRUD events between QA turns | Independent event cap; events do not consume QA-turn slots; overall budget still applies | History privacy |
| B61 | Accept/dismiss suggestion or Accept/Reject proposal | Record actual user choice and authoritative result, no additional inference | History privacy |
| B62 | CRUD invalidates pending interactive card | System invalidation, not user rejection; terminal card cannot be reused | Transaction gates |
| B63 | Access different workspace | No event/reference leakage across user or workspace boundaries | History privacy |
| B64 | Optional history/evidence over budget but complete current Plan fits | Continue Edit using bounded supporting context; no size-only rejection | Create/Edit contract |
| B65 | Full current Plan cannot fit mandatory input budget | Explain input limit; no destructive truncated regeneration | Create/Edit contract |
| B66 | Send with chip, change composer/selection, retry failed request | Chip clears at Send; retry original mode/duration/query/target/source binding, not live state | Transaction gates |
| B67 | Objective reworded or replaced | Simple prompt guidance; extra IDs acceptable, no invalid reference or knowingly transferred completion | Transaction gates |
| B68 | Progress event no longer in bounded history | Current progress not falsely asserted as historical; no required snapshots | History privacy |
| B69 | Zero sources, No Plan, ordinary Ask | Submit allowed; skip rewrite/retrieval; answer recall if supported, abstain unsupported factual content | UI/grounding |
| B70 | Zero sources, selected personal Plan, Ask/Create/Edit | Skip retrieval; relevant Plan answer or valid new/proposed blueprint; no invented source coverage; Edit requires Plan | UI/grounding |
| B71 | Valid empty result versus retrieval/auth error | Handle distinct outcomes; errors not disguised as empty | UI/grounding |
| B72 | User B accesses user A Plan/cards/history/events in same workspace | Deny private resources and prevent model-context leakage; workspace/document ACL independently checked | History privacy |
| B73 | Legacy Plan references/dispatch/UI after redesign | No active feature calls old business logic; preserve old code/schema/data; independent shared utilities and unrelated features work | Isolation/rollout |
| B74 | Full current Plan in Use with optional context overflow | Whole Plan and progress retained; trim optional items; explicit limit if required context cannot fit | Create/Edit contract |
| B75 | Large/near-limit full Edit regeneration | Measure actual/estimated budgets separately; complete valid output, preserve unrelated content; no truncation or automatic multi-call split | Create/Edit contract |
| B76 | Blueprint beyond empirically chosen hard limit | Deterministic rejection or safe explicit limit response; no data loss; soft per-field guidance not arbitrary hard caps | Create/Edit contract |
| B77 | Mixed supported Plan recall and unsupported document facts | Partial answer, truthful provenance, unsupported parts explicit, no fake citation; legacy semantics preserved | UI/grounding |
| B78 | Segment attribution transient failure after valid grounded chunk answer | Safe fallback to valid chunk citations, truthful effective mode; cancellation/ACL/invalid evidence not swallowed | UI/grounding |
| B79 | Confident wrong explanation versus correct/partial understanding | Suggest only eligible objective when warranted; main answer addresses request, no mandatory quiz | Semantic prompt |
| B80 | Edit only one activity in large Plan | Preserve objective content, other activities, days, IDs and unrelated progress; full proposal and explicit Accept | Create/Edit contract |
| B81 | Two pending suggestions on different objectives of same Plan, accept one | Accepted card terminal; other stale pending cards invalidated; another Plan unaffected | Transaction gates |
| B82 | No-op content/progress write | No revision bump or stale-card invalidation; no complex semantic matcher | Transaction gates |
| B83 | Failed uncommitted Edit then content or progress mutation, Retry | Reject stale before model, explain new request; no silent rebase | Transaction gates |
| B84 | Lost acknowledgement after committed operation then Retry | Recover authorized stored outcome before regeneration; no duplicate or resurrection | Transaction gates |
| B85 | Retry with changed selectors and original sources revoked | Keep original binding; enforce current permissions; zero-source stays zero-source | Transaction gates |
| B86 | Private GUI events across own chats with No Plan | Own authorized events only, separate event quota, no Plan body auto-injection, no extra inference | History privacy |
| B87 | Prompt evaluation after refinement | Independent untouched held-outs; first-pass and retest separate; main answer quality and auxiliary behavior judged | Semantic prompt |
| B88 | Future rollout/rollback after approval | Additive migration, data preservation, legacy isolation, regression/browser tests before UAT; no destructive rollback | Isolation/rollout |

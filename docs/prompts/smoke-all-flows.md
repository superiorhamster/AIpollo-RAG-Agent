# Prompt — Smoke test toàn bộ luồng AIpollo

Bạn là AI Agent chịu trách nhiệm kiểm thử end-to-end AIpollo. Hãy thực hiện kiểm thử, thu thập bằng chứng và báo cáo lỗi; không dừng ở việc viết checklist. Mục tiêu là xác minh tất cả luồng đã hiện thực, gồm UI, API, quyền truy cập và phần AI thật. Không triển khai feature mới hoặc tự sửa application code trong nhiệm vụ kiểm thử này. Có thể bổ sung test/harness nhỏ để lấp coverage thiếu, giữ nguyên assertion và hành vi sản phẩm.

## 1. Tiếp nhận đúng repository và trạng thái

Repository thật:

```bash
cd '/home/anhpd/Project/Group(personal)/RAG'
git branch --show-current
git rev-parse HEAD
git status --short
git diff --stat
```

Đường dẫn `/home/anhpd/Project/Group/RAG` là dự án embedding riêng. Không chạy Git/Make hoặc sửa code AIpollo ở đó.

Đọc trước:

- `AGENTS.md`, `.codex/AGENTS.md`, `README.md`.
- `.codex/GOALS.md`, `.codex/PLANS.md`, `.codex/DEPENDENCIES.md`.
- `.codex/docs/requirements-baseline.md`, `.codex/docs/product-modes.md`, `.codex/docs/service-boundaries.md`.
- `docs/ask-pipeline/sentence-citations.md`.
- `harness/build/change-20261122-smoke-reliability.md`, `harness/build/change-20261121-agentic-rag.md`.
- Public contract `services/api-gateway/app/openapi-v1.json`, task allowlist trong `services/agent-orchestrator/app/types.py`, các route/UI và test liên quan.

Dùng skill `debugging-wizard` khi chẩn đoán lỗi, `playwright-expert` khi viết/chạy browser automation. Đọc skill trước khi áp dụng; nếu sửa harness ở web, đọc thêm `apps/web/AGENTS.md`. Không cần thiết kế lại kiến trúc hoặc thêm dependency để chạy smoke.

Snapshot bàn giao, xác nhận lại vì có thể thay đổi:

- Branch `dev-DuyAnh`, HEAD `563261a` khi tài liệu này được tạo ngày 2026-11-23.
- Có local changes ở research graph, research regression và execution plans; giữ nguyên, không reset/stash/checkout đè chúng.
- Stack chính thường dùng web `http://127.0.0.1:23000`, API cổng `23001`. Xác minh runtime Origin, Compose project và overlays, không chỉ đọc giá trị mặc định.
- Main chat setting `claude-free`; người dùng đã thêm `cx/gpt-5.6-luna` vào combo. Người dùng đã yêu cầu kiểm tra Luna. Embedding `embeddinggemma-2:270m-q8_0-text`. Không tự đổi provider, route hoặc shared 9router.
- Lịch sử: running-stack smoke 13/13, UI 16/16 và Phase 03 đã PASS ở lượt trước. Đây là tham chiếu, không phải kết quả kiểm thử mới.
- Focused gap grading chưa commit đã qua 18 DB/fixture research regressions. Real-model acceptance vẫn chưa được chứng minh.
- Lượt live `rag-local-test-336780-24580` đã kết thúc với exit 1: polling document jobs nhận HTTP 503 vượt số retry cho phép, ở `tests/phase05/research_live.spec.ts:74`, trước khi có model run hoàn tất. Log `test-results/smoke-20261122/agentic-focused-live.log`, exit metadata `test-results/smoke-20261122/agentic-focused-status.txt`. Không gọi lượt này là coverage PASS hoặc model FAIL. Handoff cũ mô tả nó đang chạy là thông tin lịch sử.

Trước khi tạo test stack, kiểm tra Docker/process/log xem có agent khác hoặc lượt mới đang chạy. Không giành quyền vận hành cùng project và không chạy trùng full stack.

## 2. Phạm vi và cách bảo vệ môi trường

- Kiểm thử tất cả luồng hiện có, happy path cùng negative path trọng yếu. Tính năng có trong roadmap nhưng chưa có implementation ghi `NOT_IMPLEMENTED`, không tự xây thêm.
- Tách hai môi trường: smoke trên main stack hiện đang chạy; regression/fault injection/feature-flag testing trên Compose project riêng, dữ liệu và ports riêng. Ghi rõ image/build có chứa local patch nào. Không dùng PASS của image cũ để chứng nhận dirty worktree mới.
- Chạy tuần tự từng bộ Compose, không đồng thời các bộ Phase hoặc real-model evaluation. Giữ main stack chạy để người dùng tiếp tục sử dụng.
- Không thao tác FinManager. Không xóa development volumes, không reset DB, không chạy global Docker prune/kill/stop. Cleanup chỉ project và dữ liệu tổng hợp do lượt kiểm thử tạo ra.
- Chỉ đọc các biến cấu hình được allowlist. Không `cat .env`, in toàn bộ resolved Compose config/environment, cookies, JWT, refresh/reset token, SMTP credential hoặc provider key.
- Không lấy tài liệu riêng của người dùng để gửi model. Chỉ dùng corpus tổng hợp. Chỉ metadata tổng hợp và trích dẫn tổng hợp cần thiết xuất hiện trong report; không dump toàn bộ prompt/model output.
- Không gửi email thật. Password reset dùng SMTP sink/local capture trong test environment. Crossref discovery chỉ dùng truy vấn tổng hợp và explicit approval theo UI; không tự import full text.
- Fault injection, đổi role, disable account, stop/restart dependencies, đổi cờ, deadline hoặc provider lỗi chỉ trên isolated stack. Không promotion/disable tài khoản thật.
- Không commit, push, merge hoặc thay default feature flags của main. Gặp lỗi thì tạo bug report với cách tái hiện và đề xuất sửa phạm vi nhỏ.

## 3. Lập inventory và ma trận coverage trước khi chạy

Tạo execution plan ngắn dưới `harness/build/` và report riêng theo run ID. Inventory phải dựa trên source/contract/runtime:

| Case ID | FR/luồng/task | Mode | Actor | Flag/profile | Bước kiểm tra | Kết quả mong đợi | Test hiện có | Cần bổ sung | Trạng thái |
|---|---|---|---|---|---|---|---|---|---|

Các trạng thái dùng thống nhất: `PASS`, `FAIL`, `BLOCKED`, `NOT_RUN`, `NOT_IMPLEMENTED`, `GATED`. `GATED` nghĩa luồng đang tắt ở profile đó, không phải đã PASS luồng khi bật. Một case bị upstream 503 trước generation không phải đã kiểm chứng chất lượng model.

Bao phủ các tổ hợp ASK/PLAN/AGENT × LEARN/RESEARCH/WRITE mà backend thực sự cho phép. Mỗi task có ít nhất một ca có nội dung đúng; mỗi tổ hợp hợp lệ có một walkthrough. Không ép `socratic_tutor` hay `mock_defense` vào PLAN/AGENT: hiện hai task này là ASK-only, tổ hợp sai phải bị backend từ chối.

Task allowlist đang có:

- LEARN: `answer`, `explanation`, `study_guide`, `quiz`, `flashcards`, `mind_map`, `socratic_tutor`.
- RESEARCH: `answer`, `comparison`, `screening`, `extraction`, `evidence_table`, `synthesis`, `mock_defense`.
- WRITE: `answer`, `draft`, `rewrite`, `summary`, `citation_review`.

Đối chiếu lại allowlist tại thời điểm chạy. Không coi một câu trả lời text chung chung là đã kiểm chứng đúng cấu trúc quiz/flashcard/evidence table hoặc đúng task.

## 4. Chuẩn bị dữ liệu tổng hợp

Tạo actor Owner, Editor, Viewer, outsider ở workspace khác và một Admin riêng trong isolated stack. Platform Admin không mặc nhiên có quyền đọc tài liệu workspace.

Tạo ít nhất:

1. PDF tiếng Việt có text layer, 2–3 trang, một thông tin có đáp án rõ và một thông tin không có trong nguồn. Ghi ground truth trang/câu để kiểm tra citation.
2. Paper A dày hơn B: Alpha dùng transformer/sparse attention, latency 3 seconds/batch; không nêu dataset. Gamma 84% trong cùng protocol P, hardware Omega, seed 7.
3. Paper B: Beta dùng recurrent encoder, Vietnamese benchmark V2 gồm 1200 sequences, latency 2000 milliseconds/batch. Gamma 79% trong đúng điều kiện của A.
4. PDF/DOCX giáo trình có chương 4 Attention, giải thích Q/K/V, đủ nội dung cho curriculum ba ngày.
5. DOCX nhỏ có preview và nội dung biết trước; PDF scan/no text, file hỏng, loại không hợp lệ và file vượt giới hạn để negative test trong test stack.
6. Một đoạn prompt injection vô hại trong tài liệu tổng hợp: yêu cầu bỏ qua nguồn hoặc dùng ID giả. Đầu ra phải giữ policy/allowlist, không gọi tool ngoài phạm vi.

Giữ manifest ground truth tách khỏi model output. Tạo tài liệu rồi chọn đúng phạm vi nguồn cho từng ca; không để đáp án từ workspace khác lọt vào context.

## 5. Ma trận các luồng bắt buộc

| ID | Luồng | Hành động và tiêu chí PASS |
|---|---|---|
| ST-01 | Stack/Origin | Kiểm tra readiness và web/API qua đúng runtime Origin. Write thiếu/sai Origin bị từ chối; write hợp lệ đi qua. Anonymous protected request bị chặn. Không đổi allowlist Origin để test qua. |
| ST-02 | Đăng ký/đăng nhập | Đăng ký, xác nhận mật khẩu UI, login đúng/sai, email trùng, logout. Mật khẩu tối thiểu 8 ký tự, ít nhất một uppercase, digit và special char theo validator; kiểm tra đủ 8 hợp lệ, 7 bị từ chối và thiếu từng nhóm bị từ chối. Không tự thêm yêu cầu lowercase nếu contract không có. |
| ST-03 | Session | Access JWT hết hạn được refresh qua browser; refresh rotate; replay refresh cũ, logout, hết session và revocation bị từ chối theo contract. Kiểm tra không mất draft/chat sau renewal. Không chỉ xóa cookie rồi suy ra đã kiểm chứng tất cả expiry/rotation. |
| ST-04 | Account/reset | Account hiển thị identity/user ID; password reset token one-use và expiry, mật khẩu cũ không dùng được, session bị revoke theo contract. Không lộ tồn tại email. SMTP chưa có thì kiểm thử sink isolated và ghi rõ real email delivery chưa chạy. |
| ST-05 | Workspace/ACL | Create/list/open/rename/share Viewer/Editor, đổi/revoke membership, delete. Owner quản lý ACL; Editor/Viewer đúng giới hạn thực tế. Outsider không đọc/sửa/accept/run/download/export bằng UUID đoán được. Revoke khi đang mở tab phải được backend áp dụng. |
| ST-06 | Document lifecycle | Upload PDF và DOCX, list/select/rename/download/preview/delete. DOCX có preview PDF, original vẫn đúng. Reject file type/size/hỏng theo contract. Preview readiness khác indexing readiness. Idempotent upload không tạo bản sao. |
| ST-07 | Ingestion/index | Quan sát durable queued/running/succeeded hoặc failed có code. Đọc search thật sau index. Scan/no_text và parse timeout không publish partial index. Retry/restart idempotent không duplicate chunks/vectors; active generation/lease fencing giữ đúng. Reindex chỉ scoped synthetic workspace. |
| ST-08 | Reader/annotations | Page jump, zoom, text search, đổi nguồn, PDF/DOCX preview, notes/highlights riêng người dùng, reload giữ anchor. User khác không thấy personal notes. Source bị xóa/thu hồi quyền hiển thị lỗi phù hợp. |
| ST-09 | Source search | Chọn một/nhiều nguồn, search nội dung có/không có, click result mở đúng doc/page. Workspace/user/document filters luôn đúng; empty/invalid source selection không bypass. |
| ST-10 | ASK/multi-turn | Câu có đáp án phải đúng ground truth và có citation; câu không có phải abstain. Follow-up giữ conversation nhưng không dùng nhầm scope nguồn mới. Tách lời người học khỏi source facts. Reload/history giữ câu trả lời và citation. |
| ST-11 | Citation modes | ASK Segment và Chunk trên fresh indexed PDF; đổi mode, reload, mở history/artifact cũ. Mở đúng doc/page và vùng khi có geometry. UUID hợp lệ nhưng sai nội dung không đủ chứng minh support. Legacy/unmapped citation được fallback đúng, không ép phải có rectangle. Mode switch không reindex hoặc sửa citation đã lưu. |
| ST-12 | Retry/progress | SSE/poll status, transient failure, Retry giữ câu hỏi/sources/conversation/citation mode theo snapshot và không tạo turn trùng. Provider outage có copy EN/VI và Retry phù hợp. Invalid output/unknown evidence UUID bị chặn. Các retry phải hữu hạn, không loop chờ vô hạn. |
| ST-13 | PLAN lifecycle | Create/review/Accept/Start; trước Accept không thực thi tác dụng phụ. Accept replay idempotent. Edit/Regenerate tạo v2, invalidate v1; stale run bị từ chối. Hai tab chỉnh/accept stale version không bypass. Cancel plan/run và owner isolation đúng. Run giữ đúng accepted version và thứ tự bước đã hiển thị. |
| ST-14 | Dynamic workflow | Plan 1–6 bước hợp lệ, reject task/capability/source/step count sai. Start v2 thực thi đúng v2. Worker restart sau bước 1 tiếp tục không lặp side effect; cancellation/revoke access dừng trước bước tiếp theo. Legacy hai bước vẫn đọc/chạy đúng. |
| ST-15 | Curriculum | Tạo “Attention chương 4 trong 3 ngày”; job draft sống qua reload; chưa ready/validated không Accept. Mỗi ngày có học gì, Q/K/V/bài tập và citation đúng trang. Edit/regenerate/accept version đúng. Chương không có/provider lỗi có trạng thái cụ thể. Start tạo học liệu tuần tự, không đợi lịch ba ngày ngoài đời. |
| ST-16 | LEARN tasks | Chạy từng task allowlist; kiểm tra study guide, quiz có câu/đáp án hợp lệ, flashcards lật được, mind map có quan hệ và citation. Không chỉ kiểm tra text nonempty. |
| ST-17 | Socratic tutor | Ba lượt tiếng Việt: trả lời sai → feedback có căn cứ → hint → solution theo action. Một câu gợi mở mỗi lượt thích hợp; không gán citation giáo trình cho phát biểu sai của học sinh; click gợi ý đọc mở đúng trang. Conversation riêng không xuất thành artifact chung. |
| ST-18 | RESEARCH tasks | Comparison/screening/extraction/evidence_table/synthesis đúng cấu trúc, source attribution và nội dung. Multi-paper 2–5 paper có ô paper × criterion; trên 5 phải thu hẹp khi đi deep comparison, không áp giới hạn đó nhầm cho ASK thông thường. |
| ST-19 | Agentic coverage | Dùng cùng corpus/câu hỏi cho ASK baseline và AGENT; PLAN + RESEARCH đã accept cũng đi đúng workflow. A nhiều chunks không làm mất B method/dataset. A dataset phải insufficient, B recurrent/V2 phải supported đúng citation. Giữ đơn vị 3 seconds và 2000 milliseconds hoặc conversion có nêu rõ. Giữ cả Gamma 84%/79%, không hòa thành số bịa. Hỏi GPU memory phải abstain. |
| ST-20 | Verification/budgets | Claim/ô matrix supported/contradicted/insufficient đúng nội dung; valid UUID sai support vẫn bị phát hiện. Gap repair giữ ô đã xác minh, đọc lại có trọng tâm ô bỏ sót. Kiểm tra max gap/model/search/time/token/cost, checkpoint/restart và partial result khi hết budget. Không nới giới hạn để che lỗi. |
| ST-21 | WRITE tasks | Draft/rewrite/summary/citation_review và verified drafting có cited claims đúng nguồn. Number/unit/attribution sai bị sửa/bỏ/đánh dấu; không gắn citation xác nhận vào câu thiếu support. Preview trước save; private student/tutor text không đi vào artifact. |
| ST-22 | Mock defense | Chọn rõ draft; phân biệt missing citation/unsupported assumption/contradicted. Target anchor mở draft; counter anchor mở nguồn đối chiếu đúng. Một câu hỏi phản biện và lượt trả lời riêng. Sai draft scope hoặc mode bị backend chặn. |
| ST-23 | Artifacts/export | Owner/Editor save, list/open/rename/delete; Viewer chỉ thao tác được theo contract; replay save không duplicate. Markdown/DOCX tải mở được, giữ nội dung/citation. Citation snapshot còn đúng sau đổi preference/reindex. Nguồn mất quyền/xóa không leak nội dung/export. |
| ST-24 | Adaptive flashcards | ID ổn định cho deck mới/cũ, flip, Again/Hard/Good/Easy, due list UTC. Hai người có lịch riêng. Double submit cùng key chỉ một review; expected_version stale bị xử lý đúng. Fake clock cho quên, qua ngày, đến hạn trong fixture; không chỉnh đồng hồ host. |
| ST-25 | Concept map | Legacy artifact và nodes/edges mới, cycle, node trùng, nhãn Việt dài, nhiều citations. Keyboard/mobile thao tác được; chọn citation mở PDF đúng trang/geometry nếu có. Không render model SVG/HTML không kiểm tra; nguồn mất quyền có trạng thái đúng. |
| ST-26 | References/discovery | Search metadata, chọn/save, list/tags/remove/export BibTeX đúng contract, DOI trùng không duplicate. Corrective discovery phải đợi duyệt query; metadata không trở thành evidence. Timeout/429/retry qua fixture, Crossref thật một truy vấn nhỏ nếu kết nối cho phép. |
| ST-27 | Admin/RBAC | USER bị chặn Admin UI/API. Admin tổng hợp kiểm tra accounts, enable/disable/role, session revocation, jobs/retry, audit, services/models metadata. Chỉ sửa tài khoản/job tổng hợp trong isolated stack. Model settings view hiện có không đồng nghĩa UI có quyền thay provider; không tự kiểm thử tính năng config chưa implement. |
| ST-28 | Responsive/a11y | Desktop/mobile, EN/VI persist, keyboard focus/names, tab Chat/Library/Artifacts/References, reader/composer/scroll không che nội dung. Network/page errors, loading/empty/error/retry states có hành động rõ. Dùng screenshot/trace synthetic, không chụp private workspace. |
| ST-29 | Recovery/cleanup | Trong isolated stack: restart worker, model outage, MinIO outage/cleanup recovery, quyền bị thu hồi giữa run. Không replay mutation thiếu idempotency. Cuối lượt xóa workspace/doc/artifact tạo bởi test, revoke sessions; xác nhận không orphan objects/index theo mức quyền cho phép. Ghi rõ synthetic account nào còn lại vì không có self-delete. |
| ST-30 | Gated/unimplemented | Feature flag off phải fallback/reject theo contract và dữ liệu cũ vẫn đọc được. Formula Inspector/OCR/adapter chưa có hoặc chưa human-reviewed không được đánh PASS giả. Chạy extraction gate nếu có, báo kết quả riêng; không bật inspector chỉ vì corpus tổng hợp qua. |

## 6. Các lệnh và thứ tự chạy

Đây là các lệnh có sẵn, không phải tuyên bố chúng đã bao phủ mọi dòng ma trận. Trước khi chạy, đọc runner để biết project/port/flags, setup/cleanup và test nào thực sự được gọi. Nếu P0 làm các bước phụ thuộc không chạy được, đánh dấu BLOCKED nhưng tiếp tục các nhóm độc lập.

Main stack, sau khi xác nhận đúng config/project và không cần khởi tạo trùng:

```bash
make check
make COMPOSE_FILES='compose.dev.yaml compose.ollama.yaml' compose-check
make COMPOSE_FILES='compose.dev.yaml compose.ollama.yaml' verify
make COMPOSE_FILES='compose.dev.yaml compose.ollama.yaml' verify-provider
make COMPOSE_FILES='compose.dev.yaml compose.ollama.yaml' verify-smoke
```

Nếu Docker/main stack chưa chạy, bootstrap đúng existing project/config theo README; không tạo `.env` mới đè credential. Không rebuild/restart main chỉ để inject lỗi. Ghi rõ main image hiện tại so với source đang kiểm thử.

Tiếp theo các isolated suites, chạy xong từng lệnh và giữ exit code/log trước khi sang lệnh kế:

```bash
make verify-phase01
make verify-phase02
make verify-phase03
make verify-ui
make verify-local-rag
MODEL_CHAT_NAME=cx/gpt-5.6-luna make verify-agentic-research
make verify-formulas
```

- `verify-local-rag` mặc định kiểm chứng baseline tiếng Việt, tutor/curriculum/workflow trong profile riêng; `verify-agentic-research` là profile research. Direct Luna override trên dòng lệnh chỉ áp dụng lượt isolated đó, không sửa `.env` hoặc main.
- Lưu log vào thư mục test-results riêng cho lượt mới; nếu dùng `tee`, bật `pipefail` và giữ đúng exit code. Đặt giới hạn chờ theo runtime budgets thực tế, không retry vô hạn. Không sửa script đang được Bash đọc; nếu cần edit runner, đợi xong hoặc chạy bản copy đã cố định.
- Citation mode-switch không tự được chứng minh bởi `verify-local-rag` mặc định. Đọc citation guide; bật parser maps chỉ trong isolated profile, upload PDF mới và truyền `EXPECT_CITATION_MODE_SWITCH=1` tới chính browser container (`-e`), không chỉ export ở host rồi giả định đã truyền qua.
- Các cờ hiện có: AGENTIC_WORKFLOW_ENABLED, AGENTIC_TUTOR_ENABLED, AGENTIC_CURRICULUM_ENABLED, AGENTIC_RESEARCH_ENABLED, AGENTIC_DISCOVERY_ENABLED, AGENTIC_WRITING_ENABLED, AGENTIC_DEFENSE_ENABLED, ADAPTIVE_FLASHCARDS_ENABLED, INTERACTIVE_CONCEPT_MAP_ENABLED. Kiểm tra cờ thuộc service nào và runtime endpoint tương ứng; không chỉ sửa environment host. Feature-enabled và feature-disabled cases dùng isolated profiles.
- Phase suites có fixture/provider disabled; không ghi chúng là end-to-end model thật. UI fixture PASS cũng không chứng minh live Admin/export/reference flow đã chạy.
- Kiểm tra coverage gap của `tests/phase06/artifacts.py`, `tests/phase09/identity.py`, model-gateway adapter tests và discovery/learning tests; một file tồn tại không có nghĩa runner gọi nó. Nếu thiếu, chạy trong isolated service/DB phù hợp sau khi đọc setup, hoặc thêm runner/test nhỏ. Không chạy DB fixtures trực tiếp vào development DB.
- Provider 503: ghi endpoint, stage, request_id, retry count, service readiness/timing và runtime budgets; phân biệt polling read hỏng với parse/index job failed và với completion unavailable. Tái hiện có giới hạn. Không tăng timeout/retry hoặc sửa test để che lỗi hệ thống.
- Chỉ dùng assertions semantic/support từ nguồn thật để chấm quality. Nếu judge là cùng model ở invocation khác, ghi rõ phương pháp và giới hạn; không gọi đó là nhãn human-reviewed.
- Không chạy backup/restore trên main trong smoke. Nếu yêu cầu bao gồm production/recovery, rehearsal phải ở project mới với dữ liệu tổng hợp và hướng dẫn `docs/operations/production.md`. Nếu chưa chạy, báo NOT_RUN thay vì tuyên bố đã kiểm chứng production.

## 7. Báo cáo bắt buộc và điều kiện kết thúc

Tạo report trong test-results theo run ID và bản tóm tắt có thể review dưới harness/build. Gồm:

1. Timestamp/timezone, branch/HEAD + dirty diff, image/build provenance, main/test project, browser, Origin, provider/model và feature flags không có secrets.
2. Ma trận ST-01..ST-30 được tách thành các case nhỏ: expected/actual, mode/capability/task, actor/profile, PASS/FAIL/BLOCKED/NOT_RUN/NOT_IMPLEMENTED/GATED, artifact.
3. Command + exit code + log; screenshots/trace/network metadata/request_id khi lỗi. Giữ synthetic IDs cần tái hiện, không đưa secret vào report.
4. Mỗi bug: severity P0/P1/P2/P3, bước tái hiện, expected/actual, tần suất, tầng nghi ngờ, căn cứ và đề xuất sửa nhỏ. Phân biệt giả thuyết với nguyên nhân đã xác nhận.
5. Với research: độ phủ paper × criterion, supported-claim ratio, citation scope/page validity, missing-answer accuracy, completion/search counts, latency mẫu/p50/p95 kèm cỡ mẫu. Lượt chưa hoàn tất không có metrics cuối thì ghi rõ, không suy ra số.
6. Coverage còn thiếu và điều kiện để kiểm chứng; số liệu lịch sử đặt riêng khỏi lượt hiện tại. Không tuyên bố “tất cả đã PASS” khi còn BLOCKED/GATED/NOT_RUN.
7. Trạng thái cleanup, main stack health, dữ liệu tổng hợp còn lại và `git diff --check`. Không commit/push.

Các P0 trọng yếu là auth/tenancy, tài liệu và scope, Ask có căn cứ/citation, exact Plan acceptance, không mất dữ liệu và không lộ nguồn sau revoke. Bất kỳ P0 FAIL đều chặn kết luận sẵn sàng sử dụng. Các luồng chưa chạy hoặc bị gate phải liệt kê rõ trong kết luận, ngay cả khi smoke lõi đã PASS.

Hãy bắt đầu từ inventory và preflight, rồi thực thi theo thứ tự. Khi có blocker, báo ngắn gọn và tiếp tục phần độc lập; không dừng chỉ với một kế hoạch hoặc lời khẳng định container healthy.

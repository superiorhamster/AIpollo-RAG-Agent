# Handoff: Kiểm thử AIpollo từ lượt Luna đang chạy

## Session Metadata

- Thời điểm bàn giao: 2026-11-22, khoảng 23:16, Asia/Ho_Chi_Minh. Trạng thái bên dưới là snapshot, phải xác minh lại khi nhận việc.
- Repository thật: `/home/anhpd/Project/Group(personal)/RAG`.
- Branch: `dev-DuyAnh`; HEAD lúc bàn giao: `563261a`.
- Yêu cầu hiện tại: tiếp quản kiểm thử smoke/Agentic, kiểm tra bản sửa và báo cáo bằng chứng. Không triển khai thêm feature của roadmap.

## Current State Summary

Stack chính đã qua smoke 13/13 bước bằng provider thật, UI 16/16 và một lượt Phase 03 đầy đủ. Sau đó ca đánh giá Agentic thật phát hiện ma trận bỏ sót phương pháp recurrent của paper B. Bản sửa focused gap grading hiện chưa commit; 18 regression research/writing/defense đã qua trên PostgreSQL với quyền runtime hạn chế. Đang có một lượt đánh giá Luna thật trên Compose project riêng để kiểm chứng bản sửa. Chưa có kết quả cuối cùng của lượt này khi viết bàn giao. Việc đầu tiên là theo dõi lượt đang chạy, không khởi động một lượt trùng.

## Important Context

1. CWD mà ứng dụng có thể cấp là `/home/anhpd/Project/Group/RAG`. Đây là dự án embedding CPU riêng, không phải repository AIpollo. Phải `cd '/home/anhpd/Project/Group(personal)/RAG'` trước mọi lệnh Git/Make. Không sửa dự án CPU embedding.
2. Stack chính phục vụ web tại http://127.0.0.1:23000 và API tại cổng 23001. Giữ stack chính và dữ liệu hiện có; không tác động FinManager. Luôn dùng Compose project và `.env` hiện có khi vận hành stack chính. Không chạy `down --volumes` trên stack chính.
3. Người dùng vừa thêm `cx/gpt-5.6-luna` vào combo 9router `claude-free` và đã yêu cầu kiểm tra lại. Provider smoke qua combo và direct Luna đều thành công. Model ứng dụng vẫn là `claude-free`; direct Luna chỉ override trong evaluation riêng. Embedding vẫn là `embeddinggemma-2:270m-q8_0-text`. Không sửa shared 9router hoặc tự đổi sang model khác.
4. Đọc `AGENTS.md`, `.codex/AGENTS.md`, các execution plan bên dưới, rồi các contract liên quan. Dùng skill `debugging-wizard` để chẩn đoán và `playwright-expert` nếu sửa browser test. Nếu thay LangGraph, đọc `langchain-build-agent`. Chỉ dùng các skill thực sự cần cho phạm vi công việc.
5. Không làm mất local changes. Không reset, fetch/merge, commit hoặc push trong nhiệm vụ kiểm thử này nếu chưa được giao thêm. Các file test-results bị Git ignore, không đưa vào commit. Không in credential, cookie, authorization header, private source text hoặc toàn bộ model output.
6. Chạy từng bộ Compose kiểm thử tuần tự. Dùng dữ liệu tổng hợp, giữ tenant/source filters và exact accepted plan version. Không nới assertion chất lượng để có PASS, không bật mặc định research chỉ vì một corpus nhỏ qua.

## Immediate Next Steps

### 1. Xác minh workspace và lượt đang chạy

```bash
cd '/home/anhpd/Project/Group(personal)/RAG'
git branch --show-current
git rev-parse --short HEAD
git status --short
tail -n 20 test-results/smoke-20261122/agentic-focused-live.log
docker ps -a --filter label=com.docker.compose.project=rag-local-test-336780-24580 --format '{{.Names}} {{.Status}}'
```

Lượt hiện tại:

- Compose project: `rag-local-test-336780-24580`.
- Browser container: `rag-local-test-336780-24580-browser`.
- Log: `test-results/smoke-20261122/agentic-focused-live.log`.
- Shell wrapper sẽ ghi exit code sau khi cleanup vào test-results/smoke-20261122/agentic-focused-status.txt.
- Artifacts được copy về thư mục test-results/rag-local-test-336780-24580/ sau khi chạy/cleanup; khi đang chạy, snapshot nằm trong browser container, /tests/test-results/evaluation/research-progress.json.
- Tool terminal session ở chat cũ là 78974, nhưng không giả định chat mới truy cập được session đó. Theo dõi log và Docker là đủ.
- Snapshot lúc bàn giao: browser test đã bắt đầu, chưa có model run hoàn tất. Parser của PDF A dày từng mất khoảng 160 giây, không kết luận treo chỉ vì chưa có model result.

Có thể xem tiến độ chỉ với metadata, không dump generated text:

```bash
docker exec rag-local-test-336780-24580-browser node -e 'const fs=require("fs"),p="/tests/test-results/evaluation/research-progress.json";console.log(fs.existsSync(p)?JSON.stringify(JSON.parse(fs.readFileSync(p)).model_runs.map(x=>({case:x.case,mode:x.mode,status:x.run.status,error_code:x.run.error_code}))):"No model run completed yet")'
```

Nếu container đã bị cleanup, đọc log, exit-status và artifacts trên host. Không khởi tạo lại trước khi xác định lượt cũ đã kết thúc. Nếu shell cũ mất nhưng project còn chạy, kiểm tra browser exit status và copy artifact trước mọi cleanup; chỉ cleanup project tổng hợp có tên chính xác trên.

### 2. Đánh giá kết quả Luna và bản sửa

Đọc `tests/phase05/research_live.spec.ts`, `tests/eval/research_live_judge.py` và `tests/eval/agentic_metrics.py` để hiểu assertion, không suy ra thành công từ HTTP 200 hoặc run.status=succeeded.

Bộ live kiểm tra: baseline ASK, so sánh Agentic theo paper/tiêu chí, đơn vị 3 seconds và 2000 milliseconds, hai số liệu Gamma 84%/79%, câu không có đáp án GPU memory, WRITE đã kiểm chứng, mock defense, flashcards/FSRS replay idempotency và concept map có citation. Sau browser còn có bước chấm support/coverage và metrics model/search/latency.

- Nếu FAIL: xác định tầng lỗi (read-status/provider/retrieval/grading/verification/harness), ghi bằng chứng tối thiểu và ca tái hiện. Phân biệt lỗi model thật với regex thiếu từ đồng nghĩa. Không dump toàn bộ output vào terminal. Báo cáo patch đề xuất trước khi mở rộng thay đổi ngoài phạm vi kiểm thử.
- Nếu cần rerun sau khi lượt cũ đã kết thúc: dùng `LOCAL_RAG_SCENARIO=research MODEL_CHAT_NAME=cx/gpt-5.6-luna make verify-local-rag`, redirect vào log mới. Script tự tạo project, port và volumes riêng. Không sửa chính script khi đang chạy; lượt hiện tại dùng bản copy tạm để tránh lỗi đọc file đang bị thay đổi.
- Chỉ báo full acceptance khi browser, source-support gate và metrics đều thực sự hoàn tất. Một lượt synthetic không đủ chứng minh cải thiện thống kê trên mọi corpus; research rollout tiếp tục opt-in.

### 3. Kiểm tra regression sau bản sửa research mới

Sau khi live stack đã dọn xong, chạy `make verify-phase03` tuần tự. Lượt Phase 03 đã PASS trước đó dùng bản research cũ 17 tests; lượt mới phải gồm 18 tests. UI không đổi sau lượt 16/16 nên chỉ chạy lại `make verify-ui` nếu phát sinh thay đổi UI/harness cần nó. Xem policy trong AGENTS để bổ sung đúng checks nếu tìm ra lỗi mới.

Nếu được giao cập nhật stack chính sau khi checks qua, dùng đúng Compose configuration đang có, rebuild riêng agent-orchestrator với compose.dev.yaml và compose.ollama.yaml; không khởi động project mới do nhầm CWD hoặc project name. Main image chưa được rebuild với bản research mới trong lúc bàn giao. Sau đó chạy `make COMPOSE_FILES='compose.dev.yaml compose.ollama.yaml' verify` và `make COMPOSE_FILES='compose.dev.yaml compose.ollama.yaml' verify-smoke` khi phù hợp. Kết thúc với `git diff --check`, xác minh main stack khỏe và không còn test stack rác.

### 4. Bàn giao kết quả kiểm thử

Cập nhật execution plan với kết quả thực tế, phân biệt fixture và model thật. Báo cáo tiếng Việt: command, PASS/FAIL, artifact/log, lỗi còn lại, mức độ, cách tái hiện. Chỉ rõ kiểm thử nào chưa chạy trên patch hiện tại. Không ghi PASS từ log cũ hoặc từ việc container healthy. Giữ main stack chạy khi bàn giao.

## Architecture Overview

Model Gateway là đường gọi provider duy nhất. Agent Orchestrator sở hữu run, lease, plan acceptance, durable graph state và budgets. Retrieval sở hữu tìm kiếm theo phạm vi nguồn; Artifact Service sở hữu FSRS/concept artifacts; Workspace sở hữu discovery. Không query bảng riêng của service khác trong code triển khai. Citation chỉ được dùng ID có trong evidence thực sự cấp cho invocation đó; không thay canonical chunk/vector ranking để chữa output.

## Critical Files

| File | Vai trò |
|---|---|
| `harness/build/change-20261122-smoke-reliability.md` | Execution plan, kết quả smoke và follow-up coverage hiện tại |
| `harness/build/change-20261121-agentic-rag.md` | Roadmap đã triển khai, migration, flags và quality gates |
| `services/agent-orchestrator/app/research.py` | LangGraph, per-paper matrix, gap grading và semantic verification |
| `tests/phase05/research.py` | Regression DB/fixtures, hiện 18 tests |
| `tests/phase05/research_live.spec.ts` | Corpus và chuỗi kiểm thử real-provider |
| `scripts/verify-local-rag.sh` | Isolated real-provider Compose runner và judge |
| `scripts/verify-smoke.sh` | Smoke trên stack đang chạy với đúng runtime Origin |
| `tests/smoke/running-stack.spec.ts` | Smoke 13 bước, cleanup workspace/session |
| `docs/ask-pipeline/sentence-citations.md` | Citation invariants và quy trình kiểm chứng |

## Files Modified

Bản sửa chưa commit:

- `services/agent-orchestrator/app/research.py`: bổ sung grading_document; sau gap chỉ grade các ô insufficient của paper vừa truy vấn, với context riêng paper đó. Không ghi đè các ô đã xác minh ở lượt gap. Không bỏ qua focused grading khi retrieval trả lại cùng chunk. Vẫn tối đa hai gap searches và cùng ngân sách run.
- `tests/phase05/research.py`: mock tuân theo scope request; thêm regression thông tin có sẵn bị bỏ sót và không được làm mất ô đã xác minh. Cập nhật expectation thành initial grading + hai focused grading passes.
- `harness/build/change-20261121-agentic-rag.md`: cập nhật availability đã phục hồi và gate mới.
- `harness/build/change-20261122-smoke-reliability.md`: file execution plan mới, đang untracked.
- File handoff này cũng mới tạo; không suy ra có thay đổi do agent khác chỉ từ việc nó xuất hiện.

Hai commit local mới đã có trước bàn giao, chưa push:

- `1342eb7`: thông báo provider outage dễ hiểu bằng EN/VI và giữ Retry.
- `563261a`: target verify-smoke, concise provider failure, bounded GET503 retries khi polling index trong live harness.

## Work Completed

Kết quả đã trực tiếp quan sát:

- Provider combo claude-free PASS sau khi người dùng thêm Luna; direct Luna structured JSON/source-ID PASS.
- Running-stack smoke 13/13, zero page errors: auth/session renewal, Origin, scope, upload/index/search, immutable Plan acceptance/replay/stale-version rejection, PDF, grounded Ask/citation và cleanup.
- `make verify-ui`: 16/16 PASS.
- Fresh `make verify-phase03`: PASS toàn bộ domain/parser/index checks và 7 browser cases, trước bản sửa focused grading.
- `make verify`: PASS trước bản sửa focused grading.
- Focused patch: 18 research/writing/defense tests PASS trên PostgreSQL runtime role, tối đa 10 model calls và 4 searches trong fixture. Đây không phải real-provider quality score.

Bằng chứng còn trên máy:

- `test-results/rag-smoke-27920-14-browser/smoke-report.json`.
- `test-results/smoke-20261122/browser-final.log`.
- `test-results/smoke-20261122/ui-regression.log`.
- `test-results/smoke-20261122/phase03-final.log`.
- `test-results/smoke-20261122/research-focused-fixture.log`.
- `test-results/rag-local-test-173879-6120/evaluation/research-progress.json`: live failure trước patch.

## Decisions Made

- Giữ model/route chính claude-free theo cấu hình của người dùng; dùng Luna trực tiếp cho evaluation để biết model đang được chấm.
- Không tăng top-k/budget hoặc nới evidence assertions để che lỗi coverage.
- Snapshot live trước patch có 4 supported và 2 insufficient, trong đó B method sai là insufficient. Chỉ final snapshot không chứng minh lỗi ở initial grader hay regrade; đừng khẳng định một nguyên nhân chưa được quan sát. Code inspection và regression chỉ ra hai điểm yếu có thể sửa: skip unchanged gap read và regrade ô đã xác minh.
- Không có migration hay dependency mới trong focused patch; dữ liệu lưu vẫn phải đọc được.

## Assumptions Made

Thông tin Git/container là snapshot lúc bàn giao. Agent tiếp quản phải kiểm tra lại HEAD, local diff, Docker và model availability. Script test có cleanup tự động; thư mục artifact hoặc file exit-status có thể chưa tồn tại cho tới lúc shell hoàn tất. Không coi một test còn chạy là test thất bại.

## Potential Gotchas

- Test session dài cần refresh JWT; harness đã có refresh một lần và GET503 retries hữu hạn. Không replay tùy tiện mutating requests để chữa lỗi đọc trạng thái.
- Hãy kiểm tra cả regression recovery/restart, cancellation và strict supplied-ID validation khi review patch graph, không chỉ happy path.
- Đọc scope/context của cả grade và verify_cells; một finding phải được kiểm tra bằng chính passages đã cấp.
- Main smoke xóa workspace và revoke session; account tổng hợp vẫn còn vì không có public self-delete API.
- Không bật Formula Inspector: bộ PDF STEM vẫn chưa được người đánh giá xác nhận. Không coi smoke PASS là đã qua toàn bộ security/quality gates của roadmap.
- Một số execution plan cũ mô tả kết quả lịch sử. Ưu tiên phần cập nhật ngày 2026-11-22 và log tương ứng; không gộp các lượt khác nhau thành một lượt PASS.

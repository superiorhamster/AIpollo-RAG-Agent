# Vận hành và demo

## Khởi động local

Đọc [README của repo](../../README.md). Yêu cầu Docker Desktop/Engine, Docker Compose, Make và Bash theo hướng dẫn phát triển. Từ root dùng `make env` để tạo profile riêng và điền cấu hình qua kênh bí mật của team. Để bật redesign và sentence citations, đặt các giá trị sau trong `.env` local.

```dotenv
WEB_PORT=23000
API_GATEWAY_PORT=23001
WEB_ORIGIN=http://127.0.0.1:23000
LEARNING_PLANS_ENABLED=true
INDEX_SENTENCE_CITATIONS=true
ASK_SENTENCE_CITATIONS=auto
MODEL_PROVIDER=openai-compatible
MODEL_ALLOW_LOCAL_HTTP=false
MODEL_CHAT_NAME=gpt-4.1-mini
MODEL_EMBEDDING_NAME=gemini-embedding-2
MODEL_EMBEDDING_DIMENSIONS=3072
MODEL_EMBEDDING_REVISION=1
MODEL_EMBEDDING_PROTOCOL=openai
```

Điền `MODEL_CHAT_BASE_URL`, `MODEL_EMBEDDING_BASE_URL` và API-key variables theo endpoint HTTPS đã được team phê duyệt; token nội bộ service theo `.env.example`/bootstrap. Giữ profile local ngoài Git. Fixture chỉ phục vụ môi trường kiểm thử, các reply dạng Fixture learning plan là tín hiệu cần kiểm tra profile trước demo. Các flag Agent/Tutor/Research và artifact độc lập theo nhu cầu; curriculum/workflow legacy không kích hoạt lại đường PLAN đã fence.

```bash
docker compose -p super-agentic-rag-dev --env-file .env -f compose.dev.yaml config --quiet
docker compose -p super-agentic-rag-dev --env-file .env -f compose.dev.yaml build
docker compose -p super-agentic-rag-dev --env-file .env -f compose.dev.yaml up -d --no-build --wait
docker compose -p super-agentic-rag-dev --env-file .env -f compose.dev.yaml ps -a
curl -fsS http://127.0.0.1:23000/readyz
curl -fsS http://127.0.0.1:23001/readyz
```

Mở http://127.0.0.1:23000. Init/migration jobs thoát 0 và orchestration lên revision `orchestration_009`. README có `make bootstrap` cho lần đầu tạo stack. Khởi động lại với images sẵn có dùng lệnh `up` ở trên. Để dừng và giữ dữ liệu, chạy `docker compose -p super-agentic-rag-dev --env-file .env -f compose.dev.yaml stop`. Chọn project và profile riêng cho QA/review, không dùng chung volume hoặc port. Lần chuyển local trước demo đã dùng storage dev sạch; không có bước chuyển dữ liệu QA.

## Chẩn đoán nhanh và phục hồi

- **Learning Plans biến mất:** xem flag hiệu lực của Orchestrator và endpoint authenticated `workflow-features`. Recreate service theo profile đúng sau khi đổi biến; kiểm Web và Gateway readiness. Giữ secrets khỏi log.
- **Fixture thay vì provider thật:** xác minh tên provider, model, HTTPS và presence của keys ở Model Gateway; readiness không chứng minh provider gọi thành công. Chỉ gửi lượt live nếu có ngân sách demo được duyệt.
- **Plan stale hoặc thiếu:** mở lại Chats/History, kiểm selection và revision; mở proposal mới sau khi Plan thay đổi. Nếu Plan đã bị xóa/mất quyền, giữ No Plan hoặc chọn Plan khác.
- **Citation/index:** chờ generation active, kiểm Source đã chọn, mode và embedding fingerprint gồm model, dimension, revision và protocol. Thay model dù cùng dimension vẫn cần kế hoạch tương thích index; tránh reindex ngầm. [Citations](../ask-pipeline/sentence-citations.md)
- **Recovery:** khi cần tắt tính năng, đặt `LEARNING_PLANS_ENABLED=false` và reconcile. Giữ additive schema và legacy fence. Kiểm queued runs, schema compatibility, backups và ảnh hưởng dữ liệu trước khi đổi image. Không downgrade phá hủy hoặc xóa volume để xử lý readiness. [Gate recovery](handoff.md)

## Chuẩn bị CNN Architecture Lab

Tạo workspace mới, chỉ upload bốn PDF giáo dục tổng hợp trong [cnn-corpus/](cnn-corpus/): Foundations, Residual Networks, Densely Connected Networks và Architecture Evaluation. Mỗi PDF có ba trang. Lab-10 là benchmark giả lập. Chờ đủ bốn tài liệu index xong, dùng Ask với Segment, No Plan và 4 Sources khi bắt đầu. Chỉ gửi lệnh `/plan`/`/edit-plan` khi chip đã hiện. Dùng hội thoại lưu sẵn để trình bày không tốn provider; indexing và các câu mới có thể phát sinh phí. [Kịch bản và câu hỏi](cnn-demo.md)

Luồng gợi ý: D01/D02 citation → D08–D11 Fixed Create, preview và Reject/Accept → D13/D16c hướng dẫn và proactive → D17c/D18a/b explicit và assessment → D19d terminal → D14/D15 đối chứng Plan-only/No Plan. Đọc đúng objective trước khi Accept. Bỏ qua hoặc trình bày qua evidence với ca PARTIAL D03/D17b/D20. Xem [Kết quả kiểm chứng](verification.md) để diễn giải đúng phạm vi rehearsal.

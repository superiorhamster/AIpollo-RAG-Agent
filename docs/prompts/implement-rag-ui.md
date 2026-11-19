# Prompt hiện thực UI Super Agentic RAG

Bạn là kỹ sư frontend phụ trách hiện thực UI trong repository Super Agentic RAG. Hãy chỉnh sửa mã, chạy ứng dụng và kiểm tra các luồng thực tế. Người dùng chính là sinh viên và nhà nghiên cứu làm việc với tài liệu học thuật. Luồng ưu tiên là đăng nhập, mở workspace, tải và chọn nguồn, hỏi trợ lý, rồi bấm dẫn nguồn để mở đúng trang trong trình đọc PDF.

## 1. Đọc dự án và chọn skill

Đọc `AGENTS.md` và hướng dẫn được liên kết. Dùng `.codex/GOALS.md`, `.codex/DEPENDENCIES.md`, `.codex/docs/requirements-baseline.md` và `.codex/docs/product-modes.md` để nắm phạm vi. Đối chiếu `README.md`, hợp đồng `services/api-gateway/app/openapi-v1.json`, route trong `apps/web/app` và các bài kiểm thử Playwright có sẵn trước khi thiết kế.

Chọn skill theo phần việc và đọc `SKILL.md` của skill thực sự sử dụng.

| Phần việc | Skill ưu tiên | Việc cần áp dụng |
| --- | --- | --- |
| Định hướng và rà UI | `impeccable:impeccable` | Đọc giao diện hiện tại, xác định phân cấp thông tin, hành động chính và vấn đề responsive. |
| Hiện thực Next.js và React | `nextjs-developer` | Bám App Router, TypeScript strict và ranh giới Server/Client Component hiện có. Dùng `react-dev` nếu skill Next.js không có. |
| Kiểm thử trình duyệt | `playwright-expert` | Mở rộng bài kiểm thử hiện có để chứng minh hành vi người dùng và kiểm tra desktop, mobile, bàn phím. |

Nếu runtime thiếu một skill, tiếp tục bằng tài liệu và công cụ sẵn có rồi ghi rõ phần thay thế khi bàn giao. Nếu người dùng cung cấp thiết kế Figma để triển khai, áp dụng `figma:figma-design-to-code` hoặc `figma-design-to-code` có sẵn trước khi lấy ngữ cảnh thiết kế. Giữ phiên bản thư viện theo manifest và lockfile của repo.

## 2. Hiện thực theo thứ tự ưu tiên

1. **Workspace làm việc**. Trên desktop, bố trí khu vực làm việc chính cho câu hỏi, hội thoại và kết quả, cùng panel đọc tài liệu bên phải. Đặt danh sách tài liệu, trạng thái xử lý và chọn nguồn ở vị trí dễ thấy. Trên màn hình hẹp dùng panel hoặc tab để chuyển giữa trợ lý, nguồn và trình đọc. Giữ nội dung đang nhập, nguồn đã chọn, cuộc trò chuyện và trang PDF khi đổi panel.
2. **Ask, Plan và Agent**. Cho chọn riêng chế độ Ask, Plan hoặc Agent và năng lực Learn, Research hoặc Write. Hiển thị nguồn đã chọn trước khi gửi. Với Plan, trình bày mục tiêu, bước, nguồn, đầu ra và phiên bản cùng các hành động Accept, Edit/Adjust, Regenerate và Cancel. Chỉ bật Run khi backend xác nhận đúng phiên bản đang hiển thị đã được chấp nhận. Sau Edit hoặc Regenerate, dùng phiên bản mới từ server. Hiển thị tiến độ Agent từ trạng thái hoặc SSE của backend, cùng lỗi và thao tác hủy khi khả dụng.
3. **Nguồn và kết quả**. Duy trì upload PDF/DOCX, xem trước, tìm nguồn, tải bản gốc và ghi chú cá nhân theo quyền hiện có. Citation dùng metadata trả về để mở panel tại đúng tài liệu và trang, đồng thời giữ URL có document và page để tải lại. Hiển thị thiếu bằng chứng, preview đang tạo và index đang chờ bằng trạng thái rõ ràng. Giữ các luồng lưu artifact chia sẻ, xem hoặc xuất Markdown/DOCX, lưu tài liệu tham khảo và xuất BibTeX theo hợp đồng sẵn có.
4. **Các màn hình hỗ trợ**. Áp dụng cùng hệ thống giao diện cho đăng nhập, đăng ký, đặt lại mật khẩu, tài khoản, danh sách workspace, chia sẻ và Admin. Dựa vào vai trò platform và quyền workspace do server trả về. Quyền xem và thao tác với tài liệu, artifact và công việc thuộc về đúng phạm vi mà API đang cấp.

Ưu tiên một giao diện học thuật dễ đọc, với khoảng cách, typography, đường viền và trạng thái nhất quán. Dùng token đang có trong CSS hoặc bổ sung token khi một giá trị thực sự lặp lại. Ưu tiên tên nút theo hành động, trạng thái dễ nhận biết và bố cục có đủ không gian đọc PDF. Giữ tiếng Anh hiện có của ứng dụng trừ khi người dùng yêu cầu đổi ngôn ngữ.

## 3. Giữ hợp đồng tích hợp

- Tái sử dụng client API, cơ chế gia hạn session, Same-Origin BFF, idempotency key và đường dẫn citation hiện có. Browser gửi yêu cầu qua `/v1` cùng origin. Backend tiếp tục xác thực, kiểm tra quyền và xác nhận phiên bản Plan.
- Dữ liệu riêng tư nằm trong phạm vi người dùng và workspace được cấp quyền. Chat, plan và run là riêng tư. Chỉ lưu artifact vào thư viện chung khi người dùng có quyền thực hiện và chủ động chọn lưu.
- Dùng dữ liệu thật từ hợp đồng cho màn hình chạy chính. Với dependency hoặc API chưa sẵn sàng, hiển thị lỗi có thể thao tác và ghi rõ vướng mắc. Nếu API model hỗ trợ chat nhưng thiếu embedding, hiển thị tình trạng index tương ứng. Dùng fixture của repo để xác minh UI với dữ liệu tổng hợp.
- Giữ stack Docker Compose của RAG, cổng host Web mặc định 23000 và API Gateway 23001. Nếu môi trường ghi đè cổng, xác định địa chỉ thực tế từ cấu hình Compose. Dùng quyền và thư mục được cấp khi chỉnh mã. Giữ bí mật và dữ liệu người dùng bên ngoài fixture, screenshot và báo cáo.
- Tập trung thay đổi trong `apps/web` và bài kiểm thử liên quan. Ghi lỗ hổng hoặc giới hạn API phát hiện được kèm file và hành vi cần thiết. Áp dụng quy trình `AGENTS.md` nếu một thay đổi hợp đồng thực sự cần thiết.

## 4. Xác minh và bàn giao

- Kiểm tra luồng chính từ đăng nhập đến citation ở desktop và mobile. Kiểm tra keyboard, focus, tên có thể truy cập của các control, đọc trạng thái, tương phản và cuộn trên màn hình hẹp.
- Kiểm tra các trạng thái rỗng, tải, lỗi, 401/403, quyền Viewer, thiếu nguồn, index chưa sẵn sàng, Plan vừa đổi phiên bản, hủy run và preview bị lỗi. Xác nhận chọn citation mở đúng PDF và trang mà không mất nội dung đang làm.
- Chạy `pnpm build` trong `apps/web` và `make check`, `make compose-check` tại thư mục gốc. Khi Docker sẵn sàng, cập nhật image Web trong stack phát triển và chạy make verify. Chạy bài kiểm thử tương ứng với thay đổi. `make verify-phase01` kiểm tra auth/workspace, `make verify-phase02` kiểm tra tài liệu, `make verify-phase03` kiểm tra indexing và luồng Plan dẫn tới citation với fixture.
- Bàn giao các màn hình đã làm, các file chính, lệnh kiểm thử và kết quả quan sát được. Đính kèm ảnh desktop/mobile bằng dữ liệu tổng hợp khi có công cụ chụp. Ghi rõ phần còn chờ xác minh, lỗi còn lại và quyết định thiết kế cần người dùng kiểm tra.

Nếu người dùng yêu cầu nhiều agent làm song song, giao phần giao diện chung và auth/workspace cho một agent, phần workspace assistant và trình đọc cho một agent, và Playwright cho một agent. Chốt ranh giới file dùng chung trước khi sửa. Một agent tích hợp chạy lại toàn bộ luồng ưu tiên trên Compose.

# AIpollo — Team Demo: CNN Architecture Lab

**Mục tiêu:** trình diễn Ask, citation, Learning Plan và học tập thích ứng trên DEV 23000. Kịch bản được tổng hợp từ buổi diễn tập ngày 27/11/2026; kết quả LLM có thể thay đổi giữa các lần chạy. Đây không phải chứng nhận release hay kiểm thử bảo mật toàn diện.

## 1. Chuẩn bị

- Mở http://127.0.0.1:23000, đăng nhập tài khoản demo, tạo workspace **CNN Architecture Lab** mới nếu muốn chạy lại từ đầu. Không cần xóa workspace đã diễn tập.
- Upload đúng bốn PDF trong [cnn-corpus/](cnn-corpus/): `01_CNN_Foundations.pdf`, `02_Residual_Networks.pdf`, `03_Densely_Connected_Networks.pdf`, `04_Architecture_Evaluation.pdf`. Chờ indexing hoàn tất.
- Không upload hướng dẫn, đáp án hoặc đáp án tham chiếu. Lab-10 là benchmark giả lập phục vụ giáo dục, không phải kết quả thực nghiệm của paper gốc.
- Dùng Ask mode, Segment mặc định, 4/4 Sources và No Plan trừ khi có chỉ dẫn khác. Kiểm tra Plan Selector ở sidebar. Các command `/plan`, `/edit-plan` phải được kích hoạt thành chip trước khi gửi nội dung.
- Khi có Completion Suggestion, đọc đúng tên objective trước khi Accept. Nếu sai, Reject; không đánh dấu mục tiêu sai chỉ để demo chạy tiếp.

## 2. Part A — Intelligent RAG

### D01 — Numerical QA và Segment Citation

New chat; Segment; No Plan; 4/4 Sources (đúng thiết lập thực tế lúc diễn tập).

> Theo ví dụ trong tài liệu, một lớp convolution sử dụng kernel 3×3 với 32 input channels và 64 output channels có bao nhiêu tham số trong trường hợp có bias và không có bias? Kích thước feature map thay đổi như thế nào sau convolution và max pooling?

Kỳ vọng: 18.432 không bias, 18.496 có bias; 32×32×32 → 32×32×64 → 16×16×64. Bấm citation CNN Foundations trang 1 để xem highlight. **Đã đạt** về số liệu và highlight; không chứng minh single-source isolation vì dùng cả bốn tài liệu.

### D02 — Chunk Citation

New chat; đổi sang Chunk; giữ 4 Sources, No Plan. Gửi lại nguyên văn D01, bấm citation CNN Foundations trang 1. So sánh vùng highlight với Segment. **Đã đạt** theo ảnh và thiết lập được yêu cầu. Sau đó chuyển về Segment.

### D03 — Tổng hợp nhiều tài liệu (tùy chọn, có hạn chế đã biết)

New chat; Segment; 4 Sources; No Plan.

> So sánh cách ResNet và DenseNet kết hợp feature maps, và giải thích vì sao DenseNet-121 có ít tham số hơn ResNet-50 nhưng lại sử dụng nhiều bộ nhớ và có độ trễ cao hơn trong benchmark Lab-10. Nếu mục tiêu là chọn mô hình cho Research profile, bạn sẽ chọn mô hình nào và vì sao?

Kỳ vọng: addition vs concatenation; ít weights không đồng nghĩa ít activation memory; Research chọn DenseNet-121 theo decision policy. **PARTIAL** trong diễn tập: giải thích kiến trúc đúng nhưng lặp lại câu hỏi cuối, không kết luận.

Follow-up D03b (cùng chat):

> Vậy theo benchmark Lab-10, nếu chọn mô hình cho Research profile thì tôi nên chọn mô hình nào? Hãy đối chiếu ba điều kiện về accuracy, median latency và peak memory trước khi kết luận.

**PARTIAL:** xác định đúng cả hai ứng viên đủ điều kiện nhưng nói thiếu quy tắc ưu tiên. Không cần retry nhiều lần; chuyển sang Part B. D04–D07 chưa chạy.

## 3. Part B — Learning Plan Management

### D08 — Fixed Duration Create

New chat; No Plan; 4 Sources; Segment. Kích hoạt `/plan`, chỉ cho team thấy bảng Auto/1–7, chọn **3 days**. Không ghi số ngày trong câu hỏi.

> Tôi đã có kiến thức cơ bản về Deep Learning và muốn tìm hiểu sâu hơn về các kiến trúc CNN. Hãy xây dựng cho tôi một kế hoạch học tập dựa trên các tài liệu đã cung cấp, tập trung vào cơ chế của ResNet, DenseNet và cách lựa chọn kiến trúc phù hợp với điều kiện triển khai thực tế.

**PASS** trong diễn tập: Plan tên “Hiểu sâu về kiến trúc CNN: ResNet và DenseNet”, 3 ngày, 3 objectives. Kiểm tra card preview và sidebar tự chọn Plan. Nội dung thực tế:

| Ngày | Objective |
|---|---|
| 1 | Hiểu cơ chế và cấu trúc của ResNet và DenseNet |
| 2 | So sánh hiệu năng và tài nguyên của ResNet và DenseNet qua benchmark Lab-10 |
| 3 | Lựa chọn kiến trúc CNN phù hợp với điều kiện thực tế và mục tiêu nghiên cứu |

Nếu lần chạy mới sinh tên hoặc phân bổ khác, điều chỉnh các câu sau theo Plan thực tế, không mặc định objective IDs/tên giống hệt.

### D09 — Detail & Preview (không gọi LLM)

Bấm Open Learning Plan, xem nhóm Day → Objective → Suggested Activities, tiến độ 0/3, mỗi objective có 3 activities trong lần diễn tập. Quay lại Chats. **PASS.**

### D10 — Edit & Reject

Cùng chat tạo Plan; chọn đúng Plan, 4 Sources, `/edit-plan`.

> Tôi muốn tìm hiểu thêm về MobileNet và depthwise separable convolution. Hãy bổ sung một mục tiêu học tập mới vào ngày thứ nhất với hai hoạt động: tìm hiểu cơ chế depthwise separable convolution và so sánh chi phí tính toán với convolution thông thường. Giữ nguyên thời lượng 3 ngày và toàn bộ các mục tiêu, hoạt động hiện có.

Xem Change Preview và Full proposed plan. Bấm Reject; mở Plan để kiểm tra vẫn 3 ngày, 3 objectives, 0/3. **PASS** theo trạng thái sau Reject.

### D11 — Edit & Accept

Kích hoạt `/edit-plan` lại, gửi cùng yêu cầu D10 để có proposal mới. Kiểm tra đúng thay đổi rồi Accept. Mở Plan: 3 ngày, 4 objectives, 0/4; Day 1 có hai objectives, các mục tiêu và activities cũ giữ nguyên. **PASS** theo ảnh sau Accept. D12 Auto Create chưa chạy.

## 4. Part C — Adaptive Learning (mạch demo chính)

### D13 — Plan-aware Learning

New chat; chọn Plan CNN đã chỉnh sửa; 4 Sources; Segment; Ordinary Ask (không command). Giữ cùng chat xuyên suốt D13–D19d.

> Chúng ta bắt đầu học theo kế hoạch nhé. Hôm nay tôi nên học những gì? Hãy hướng dẫn tôi bắt đầu với mục tiêu học tập đầu tiên.

**PASS:** nhận biết mục tiêu ResNet/DenseNet và ba activities, From your Learning Plan, không có Completion Suggestion.

### D16a — Giảng bài

> Tôi vẫn chưa hiểu rõ sự khác biệt giữa skip connection trong ResNet và dense connection trong DenseNet. Bạn có thể giải thích cơ chế của hai kiến trúc này, cách kết hợp feature maps và cho tôi ví dụ minh họa được không?

Kỳ vọng: addition, concatenation, ví dụ tensor, citation; chưa đề xuất hoàn thành. Đã thấy giải thích đúng (56×56×64 cộng giữ shape, 32 + 4×12 = 80 channels). Ảnh bị cắt cuối nên chưa xác nhận độc lập toàn bộ phần không có card.

### D16b — Hiểu một phần

> À, vậy là ResNet cộng các feature maps còn DenseNet nối chúng theo chiều channel. Tôi hiểu phần này rồi, nhưng vẫn chưa rõ bottleneck block trong ResNet hoạt động như thế nào và tại sao nó giúp giảm chi phí tính toán.

Kỳ vọng: 1×1 giảm kênh → 3×3 → 1×1 mở rộng, chưa hoàn thành objective. Giải thích đúng trong diễn tập; ảnh cuối bị cắt, có thông báo thiếu bằng chứng hơi thừa. Kiểm tra không có card khi demo.

### D16c — Proactive Completion

> À, bây giờ tôi hiểu rồi. ResNet sử dụng residual connection để cộng các tensor có kích thước tương thích, còn DenseNet nối feature maps từ các lớp trước theo chiều channel.
>
> Trong ResNet, basic block sử dụng hai convolution 3×3, còn bottleneck block sử dụng 1×1 để giảm số kênh, 3×3 để xử lý đặc trưng và 1×1 để mở rộng lại số kênh, nhờ đó giảm chi phí tính toán.
>
> Với DenseNet, mỗi layer bổ sung k kênh mới theo growth rate. Ví dụ ban đầu có 32 kênh, growth rate bằng 12 thì sau 4 layer sẽ có 80 kênh. Như vậy tôi đã hiểu được sự khác biệt về cơ chế và cấu trúc của hai kiến trúc này rồi.

**PASS:** card chủ động chọn đúng objective ResNet/DenseNet dù không yêu cầu đánh dấu hoàn thành. Accept, mở Learning Plans: **1/4**, MobileNet vẫn Pending. Đã xác nhận bằng ảnh.

### D19a — Progress Awareness

Quay lại chat học tập.

> Oke, chúng ta học tiếp nhé.

**PASS:** nhận biết mục tiêu đầu đã hoàn thành và chuyển sang MobileNet cùng Day 1, không nhảy sang Day 2.

### D17a — Học MobileNet

> Hãy giải thích cho tôi cách depthwise separable convolution trong MobileNet hoạt động và tại sao nó tiết kiệm chi phí tính toán hơn convolution thông thường. Cho tôi một ví dụ cụ thể để dễ hình dung.

**PASS:** depthwise từng kênh + pointwise 1×1; ví dụ 18.432 so với 2.336 weights, giảm khoảng 87,3%; citation Architecture Evaluation trang 1; không card.

### D17b — Explicit Completion (ca hạn chế, tùy chọn)

> Oke, tôi đã hiểu cách MobileNet tách convolution thành hai bước depthwise và pointwise, cũng như lý do nó giúp giảm chi phí tính toán. Chúng ta kết thúc mục tiêu học tập này ở đây nhé.

**PARTIAL:** lời giải thích nói MobileNet nhưng card chọn Day 2 (benchmark), còn nói đã hoàn thành trước Accept. Reject card sai. Trong demo chính có thể bỏ lượt này và dùng D17c ngay; lưu ý D17c chưa được diễn tập như một lượt độc lập không có D17b.

### D17c — Explicit Completion với mục tiêu rõ ràng

> Tôi muốn đánh dấu mục tiêu học tập “Tìm hiểu MobileNet và depthwise separable convolution” của ngày thứ nhất là đã hoàn thành.

**PASS ở bước proposal** trong diễn tập sau D17b: đúng MobileNet, nói rõ Pending. Accept, kiểm tra 2/4 (mốc này chưa có ảnh manager riêng trong diễn tập).

### D18a — Requested Assessment: Negative

> Chúng ta chuyển sang mục tiêu học tập ngày thứ hai nhé. Theo tôi hiểu, DenseNet-121 có ít tham số hơn ResNet-50 nên chắc chắn sử dụng ít bộ nhớ hơn và có độ trễ thấp hơn trong benchmark Lab-10. Bạn đánh giá xem tôi đã hiểu đúng và đủ để hoàn thành mục tiêu học tập này chưa?

**PASS:** phát hiện sai, giải thích activation memory và độ trễ, không xuất hiện card. Đây là câu cố ý sai của người học.

### D18b — Requested Assessment: Positive

> À, tôi hiểu rồi. Trong benchmark Lab-10, ResNet-50 đạt accuracy 93,1%, median latency 17,4 ms và peak memory 410 MiB. DenseNet-121 đạt accuracy 94%, median latency 24,8 ms và peak memory 590 MiB.
>
> Mặc dù DenseNet có ít tham số hơn, cơ chế nối và tái sử dụng feature maps từ các lớp trước có thể làm tăng activation memory và chi phí truy cập bộ nhớ. Vì vậy, khi triển khai thực tế, chúng ta không thể chỉ dựa vào số lượng tham số mà còn phải xem xét latency, memory và đặc điểm phần cứng.
>
> Bạn đánh giá xem với những hiểu biết này, tôi đã đạt mục tiêu học tập ngày thứ hai chưa?

**PASS ở bước proposal:** đúng objective Lab-10. Accept, kiểm tra 3/4 (chưa có ảnh manager riêng).

### D19b — Tiếp tục theo tiến độ

> Oke, chúng ta học tiếp phần còn lại của kế hoạch nhé. Tôi cần nắm được những gì để hoàn thành mục tiêu cuối cùng?

**PASS:** xác định đúng mục tiêu Day 3, nhắc ba activities, không card sớm.

### D19c — Final Objective Assessment

> Theo những gì tôi đã học, việc lựa chọn kiến trúc CNN phụ thuộc vào mục tiêu và giới hạn tài nguyên.
>
> Với benchmark Lab-10, tôi sẽ chọn DenseNet-121 cho Research profile vì nó đáp ứng cả ba điều kiện và có accuracy cao nhất. Với Balanced deployment, tôi chọn ResNet-50 vì DenseNet-121 vượt giới hạn latency và memory. Còn với Edge deployment, tôi chọn MobileNet V1 vì đáp ứng các ràng buộc tài nguyên và accuracy.
>
> Như vậy, không có kiến trúc nào tốt nhất trong mọi trường hợp. Chúng ta cần cân nhắc đồng thời accuracy, latency và memory.
>
> Bạn đánh giá xem tôi đã đạt mục tiêu học tập cuối cùng chưa?

**PASS ở bước proposal:** đúng objective cuối. Đây là đánh giá kiến thức đã được người dùng cung cấp, không chứng minh AI tự truy xuất đầy đủ decision policy. Accept và mở manager kiểm tra 4/4.

### D19d — Terminal Awareness

Quay lại chat học tập.

> Oke, chúng ta học tiếp nhé.

**PASS về hành vi chính:** nhận biết các nội dung đã hoàn thành, không tạo card trùng hoặc mục tiêu mới. Provenance From this chat chưa tối ưu; ảnh không có manager 4/4. Lượt D14 sau đó báo mọi objective completed.

### D20 — Learning Events xuyên conversation (tùy chọn)

New chat; No Plan; bỏ chọn cả 4 Sources; Ordinary Ask.

> Gần đây tôi đã hoàn thành những mục tiêu học tập nào?

**PARTIAL:** nhắc được ResNet/DenseNet, benchmark và lựa chọn kiến trúc nhưng bỏ sót MobileNet; nhãn From this chat. Không coi kết quả là chứng minh đầy đủ event retrieval hoặc ACL.

### D14 — Plan-only Ask

New chat; chọn Plan CNN; 0/4 Sources; Ordinary Ask.

> Trong kế hoạch học tập hiện tại của tôi, ngày thứ nhất có những mục tiêu và hoạt động học tập nào? Tiến độ toàn bộ kế hoạch hiện tại ra sao?

**PASS:** liệt kê hai objectives ngày 1, đủ năm activities, báo toàn bộ objectives completed; From your Learning Plan, không document citation.

### D15 — No Plan Isolation

New chat; **No Plan**, 0/4 Sources; Ordinary Ask. Gửi lại nguyên văn D14.

**PASS:** yêu cầu người dùng chọn Plan, không tự tiết lộ nội dung Plan hiện tại. Ảnh xác nhận cả No Plan và 0/4 Sources. Đây là đối chứng hành vi, không thay thế kiểm tra ACL.

## 5. Đáp án nhanh cho người trình diễn

| Model | Accuracy | Median latency | Peak memory |
|---|---:|---:|---:|
| Plain CNN | 88,4% | 13,2 ms | 260 MiB |
| ResNet-50 | 93,1% | 17,4 ms | 410 MiB |
| DenseNet-121 | 94,0% | 24,8 ms | 590 MiB |
| MobileNet V1 | 89,8% | 9,6 ms | 210 MiB |

| Profile | Min accuracy | Max latency | Max memory | Chọn |
|---|---:|---:|---:|---|
| Research | 93% | 25 ms | 600 MiB | DenseNet-121 |
| Balanced | 92,5% | 20 ms | 450 MiB | ResNet-50 |
| Edge | 89,5% | 12 ms | 256 MiB | MobileNet V1 |

Decision policy theo đáp án tham chiếu của buổi diễn tập: lọc ứng viên đạt mọi ràng buộc, ưu tiên accuracy cao nhất, sau đó latency và memory nếu hòa. Các số liệu trên là dữ liệu demo giả lập.

## 6. Findings và giới hạn

- D03/D03b: tổng hợp thiếu kết luận và false abstention về quy tắc lựa chọn; chưa xác định nguyên nhân.
- D17b: lời giải thích đúng chủ đề nhưng card chọn sai objective; Reject rồi yêu cầu rõ tên mục tiêu. Chưa có bằng chứng backend ghi sai.
- D20: nhớ 3/4 mục tiêu; provenance chưa chính xác.
- Một số câu trả lời lộ ID bằng chứng nội bộ (E1, E2, E4, E6 hoặc E1, E5, E8); nhiều citation pill cùng dòng làm đoạn văn hẹp. Ghi nhận để bàn giao, không mở thêm vòng tối ưu.
- D04–D07, D12, D21–D23 chưa chạy trong buổi CNN rehearsal; không đánh dấu PASS. Persistence, manual CRUD và Retry có evidence riêng từ QA trước, không đồng nghĩa được kiểm chứng lại ở corpus này.
- Mốc 2/4, 3/4, 4/4 chưa có ảnh manager riêng trong lượt diễn tập; cần nhìn trực tiếp khi demo. Kết quả 1/4 đã quan sát được. Không coi ảnh bị cắt là bằng chứng chắc chắn không có card.
- Không mở lại các hạn chế AI đã được Owner chấp nhận; extended technical gates A/B/C vẫn mở. Không tuyên bố release readiness.

## 7. Lời kết trình diễn

AIpollo không chỉ hỏi đáp trên PDF mà còn cho phép người dùng quản lý Learning Plan như một context độc lập, chỉnh sửa có xác nhận, theo dõi tiến độ và đề xuất hoàn thành dựa trên quá trình học. Ba cơ chế Completion là proactive, explicit và requested assessment; người dùng luôn quyết định Accept/Reject.

**Phạm vi tài liệu:** tổng hợp câu hỏi và kết quả từ cuộc diễn tập trong chat, không phải tái kiểm tra source code hay toàn bộ PDF trong lượt tạo file này. Các case tùy chọn được giữ để minh bạch, không biến kết quả PARTIAL thành PASS.

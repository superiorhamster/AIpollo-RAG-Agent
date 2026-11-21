# Implement history-aware Ask in AIpollo

Read the repository instructions and inspect the current checkout before editing. Start with `docs/ask-pipeline/architecture.md`, `debugging.md`, and `segment-05-audit-report.md` if available. Verify the Orchestrator worker, history query, Model Gateway, response schemas, and citation rendering against the implementation.

Use these references to inform the flow and adapt it to this repo:

- https://developers.llamaindex.ai/python/framework-api-reference/chat_engines/condense_plus_context/
- https://aclanthology.org/2022.emnlp-main.679/

Scope the behavior change to Ask. Preserve other interaction modes and existing citation requirements for structured tasks.

## 1. Load bounded Q&A history

Load earlier turns from the same authorized conversation in chronological order. Include the original user question and accepted assistant claim text. Exclude the current run and failed or cancelled runs. A successful abstention can contribute a question with no answer. Keep the original current question unchanged. Do not include old retrieved passages or old citations as evidence for the new turn.

## 2. Rewrite only for retrieval

When history is available, call the existing Model Gateway with a dedicated prompt containing the prior Q&A and original question. Ask for one standalone search query that resolves references like “phòng đó” and “cái đó”, preserves intent, and neither answers the question nor guesses missing facts.

Pass the rewritten query only to retrieval. Preserve selected source IDs, access checks, active-generation filtering, hybrid ranking, and top-k. With no history, use the original question directly. If rewrite fails or returns unusable output, fall back to the original question while honoring the existing run deadline and cancellation rules.

## 3. Generate from the original question, Q&A history, and fresh evidence

Send the original question, bounded Q&A history, task instructions, and passages retrieved for this turn to the answer model. The rewritten query must not be put into the answer prompt.

Use history to resolve references and recall facts explicitly supplied in the chat. Treat prior assistant answers as context. Require current passages to support factual claims about documents, including derived claims whose premises span multiple passages.

For Ask answers, distinguish document-supported claims from conversation-sourced claims. A conversation-sourced claim may have `evidence: []` and must render without PDF citation pills. Document claims still require nonempty evidence and membership checks against the current packed passage IDs. Split mixed statements into distinct claims so a document citation only attaches to a statement the document supports.

Update validation, persisted result handling, and UI consumers as needed. Keep old results readable. Document questions with insufficient support should still abstain. A question about what the user said may be answered from eligible history without PDF citation. Keep current UI source-selection rules.

## 4. Add short demonstrations

Include concise input/output examples for:

- Two independent claims supported by the same passage.
- A derived claim supported by two passages, using both evidence IDs.
- A mixed answer containing a document claim and a chat-only claim without citation.
- An unsupported document question returning `{"claims":[]}`.

Mark example IDs as examples and instruct the model to cite only current-request evidence IDs. Preserve backend validation and account for the additional prompt size.

## 5. Verify with synthetic regressions

Use the three synthetic sources from the workspace “Chuẩn bị demo AIpollo”:

- Schedule: internal demo Friday at 09:30 in B2-302, instructor demo Friday at 14:00 in B4-201.
- Checklist: B2-302 uses direct HDMI, B4-201 requires an HDMI-to-VGA adapter.
- Borrowing guide: the adapter is available at B4-105. Register at least 30 minutes before the demo.

Test the following in the same conversation:

1. “Buổi demo với giảng viên diễn ra lúc mấy giờ và ở phòng nào?” Expect 14:00 and B4-201 with the schedule cited.
2. “Vậy vào phòng đó thì laptop nhóm tôi cần mang thêm gì để chiếu?” Assert that the rewrite resolves B4-201, retrieval finds the checklist, and generation uses the original question and cites the adapter requirement.
3. “Cái đó mượn ở đâu, và chậm nhất mấy giờ phải đăng ký?” Expect B4-105 with the borrowing guide and 13:30 with both the schedule and borrowing rule cited.

Also cover new-chat isolation, rewrite fallback, conversation-only claims without PDF pills, invalid evidence IDs, and abstention with no support for a document question. Verify the rewritten query never enters the answer prompt and old citations never become fresh evidence.

If the two original `interaction_unavailable` runs are available locally, inspect their existing diagnostic records. Distinguish confirmed findings from hypotheses. Help distinguish rewrite, retrieval, and compose failures in diagnostic logging without logging secrets or complete prompts.

Reuse existing components. Keep `.env` unchanged. Use synthetic fixtures or mocks in automated tests and do not call live providers in those tests. Report the files changed, tests run, and any remaining live UI checks. Include the final rewrite and answer prompts for review.

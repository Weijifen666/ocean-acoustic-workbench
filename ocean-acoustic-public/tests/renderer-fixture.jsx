import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import assert from "node:assert/strict";
import RichMessage, {
  AnswerMarkdown,
  evidenceRows,
} from "../src/RichMessage.jsx";
import { SimulationDraftCard } from "../src/SimulationAssist.jsx";
let checks = 0;
function test(name, fn) {
  fn();
  checks++;
  console.log("PASS " + name);
}
const message = {
  role: "assistant",
  status: "complete",
  model_used: true,
  requested_model: "requested-alias",
  response_model: "actual-response-id",
  model_provider: "test-provider",
  text: "## 声学结果\n\n| 频率 | 深度 |\n| --- | --- |\n| 100 Hz | 500 m |\n\n公式 \\(c=1500\\) 与来源 [E1]。未匹配 [999]。\n\n\\[TL=-20\\log_{10}|p|\\]\n\n```matlab\nf = 100;\nplot(r, TL); % 曲线\n```",
  evidence: [
    {
      id: "E1",
      text: "资料中的证据片段",
      label: "真实来源",
      source_id: "S1",
      pdf_page: 9,
    },
  ],
  citations: [
    { evidence_id: "E1", label: "真实来源", source_id: "S1", pdf_page: 9 },
  ],
};
const html = renderToStaticMarkup(<RichMessage message={message} />);
test("Markdown heading and GFM table", () => {
  assert(html.includes("<h2>声学结果</h2>"));
  assert(html.includes("<table>"));
});
test("inline and display LaTeX", () => {
  assert(html.includes("katex-display"));
  assert(html.includes("katex-mathml"));
  assert(!html.includes("katex-error"));
});
test("MATLAB highlighting and copy action", () => {
  assert(html.includes("language-matlab"));
  assert(html.includes("hljs-"));
  assert(html.includes("复制代码"));
});
test("only actual evidence identifiers become inline links", () => {
  assert(html.includes('class="inline-evidence"'));
  assert(html.includes("[999]"));
  assert.equal(evidenceRows(message)[0].text, "资料中的证据片段");
});
test("actual response identity remains distinct from requested alias", () => {
  assert(html.includes("actual-response-id"));
  assert(html.includes("requested-alias"));
  assert(html.includes("返回标识"));
});
test("truncated output notice is visible", () => {
  const result = renderToStaticMarkup(
    <RichMessage
      message={{
        ...message,
        completion_status: "truncated",
        completion_notice: "输出达到上限，回答尚未结束。",
      }}
    />,
  );
  assert(result.includes("输出达到上限，回答尚未结束。"));
});
test("raw HTML and script links are not executable markup", () => {
  const result = renderToStaticMarkup(
    <AnswerMarkdown
      text={"<script>alert(1)</script>\n\n[bad](javascript:alert(1))"}
    />,
  );
  assert(!result.includes("<script>"));
  assert(!result.includes('href="javascript:'));
});
test("failed requests stay visible and retain retry action", () => {
  const result = renderToStaticMarkup(
    <RichMessage
      message={{
        text: "请求未完成：网络中断",
        request_failed: true,
        retry_text: "原问题",
      }}
      onRetry={() => {}}
    />,
  );
  assert(result.includes("网络中断"));
  assert(result.includes("重试这次请求"));
});
test("no model call and unknown call states remain distinct", () => {
  const no = renderToStaticMarkup(
      <RichMessage message={{ text: "检索", model_used: false }} />,
    ),
    unknown = renderToStaticMarkup(
      <RichMessage message={{ text: "未知", model_used: null }} />,
    );
  assert(no.includes("未调用模型"));
  assert(unknown.includes("调用记录未提供"));
});
test("draft missing fields prevent apply; assumptions are readable", () => {
  const result = renderToStaticMarkup(
    <SimulationDraftCard
      draft={{
        draft_plan: { frequencies_hz: [100] },
        missing_fields: [
          { field: "receiver_depth_m", question: "接收深度是多少？" },
        ],
        assumptions: [
          { field: "range_points", value: 201, reason: "默认采样点" },
        ],
        ready_for_preview: false,
        model_used: false,
      }}
      onApply={() => {}}
    />,
  );
  assert(result.includes("接收深度是多少"));
  assert(result.includes("默认采样点"));
  assert(result.includes("disabled"));
  assert(!result.includes("[object Object]"));
});
console.log(`Renderer checks: ${checks} passed`);

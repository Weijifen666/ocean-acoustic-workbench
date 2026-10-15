import assert from "node:assert/strict";
import { readChatResponse } from "../src/chat-stream.mjs";
import test from "node:test";
const encoder = new TextEncoder();
function stream(text, oneByte = false) {
  const bytes = encoder.encode(text);
  return new Response(
    new ReadableStream({
      start(controller) {
        if (oneByte)
          for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
        else controller.enqueue(bytes);
        controller.close();
      },
    }),
    { headers: { "Content-Type": "text/event-stream" } },
  );
}
await test("real deltas survive byte-split UTF-8 and metadata is retained", async () => {
  let result = "",
    stage = "";
  const final = {
    reply: "海洋🌊",
    model_used: true,
    response_model: "actual",
    context: { cached_tokens: 0 },
    simulation_draft: { ready_for_preview: false },
  };
  const response = stream(
    `event: status\ndata: {"stage":"generating","message":"生成中"}\n\nevent: delta\ndata: {"text":"海洋🌊"}\n\nevent: done\ndata: ${JSON.stringify(final)}\n\n`,
    true,
  );
  const data = await readChatResponse(response, {
    onStatus: (value) => (stage = value.stage),
    onDelta: (value) => (result += value),
  });
  assert.equal(result, "海洋🌊");
  assert.equal(stage, "generating");
  assert.deepEqual(data, final);
});
await test("legacy JSON remains compatible", async () => {
  assert.equal(
    (
      await readChatResponse(
        new Response(JSON.stringify({ reply: "旧接口" }), {
          headers: { "Content-Type": "application/json" },
        }),
      )
    ).reply,
    "旧接口",
  );
});
await test("EOF without done is never complete", async () => {
  await assert.rejects(
    readChatResponse(stream('event: delta\ndata: {"text":"部分回答"}\n\n')),
    (error) => error.code === "STREAM_INCOMPLETE",
  );
});
await test("server error code is preserved", async () => {
  await assert.rejects(
    readChatResponse(
      stream(
        'event: error\ndata: {"detail":"额度不足","code":"PROVIDER_QUOTA"}\n\n',
      ),
    ),
    (error) => error.code === "PROVIDER_QUOTA",
  );
});
await test("HTTP errors are not rendered as answers", async () => {
  await assert.rejects(
    readChatResponse(
      new Response(
        JSON.stringify({ detail: "认证失败", code: "AUTH_FAILED" }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      ),
    ),
    (error) => error.status === 401 && error.code === "AUTH_FAILED",
  );
});
await test("CRLF and final frame without delimiter are accepted", async () => {
  assert.equal(
    (await readChatResponse(stream('event: done\r\ndata: {"reply":"完成"}')))
      .reply,
    "完成",
  );
});

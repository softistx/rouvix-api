import { describe, expect, test } from "bun:test";
import { africasTalkingSmsSender } from "./africas-talking";
import { SmsSendError } from "./sms";

const message = { to: "+237600000001", text: "Code 123456", countryCode: "CM" };
const answer = (status: string) =>
  Response.json({ SMSMessageData: { Recipients: [{ status }] } });

function sender(respond: (request: Request) => Promise<Response> | Response) {
  const calls: Request[] = [];
  const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    calls.push(request);
    return respond(request);
  }) as typeof fetch;
  return {
    calls,
    send: africasTalkingSmsSender({
      username: "sandbox",
      apiKey: "key",
      senderId: "ROUVIX",
      baseUrl: "https://api.sandbox.africastalking.com",
      fetch: fakeFetch,
    }).send,
  };
}

describe("africasTalkingSmsSender", () => {
  test("posts a form to the messaging endpoint with the key in a header", async () => {
    const { calls, send } = sender(() => answer("Success"));
    await send(message);
    const [request] = calls;
    expect(request?.url).toBe(
      "https://api.sandbox.africastalking.com/version1/messaging",
    );
    expect(request?.method).toBe("POST");
    expect(request?.headers.get("apiKey")).toBe("key");
    const form = new URLSearchParams(await request?.text());
    expect(Object.fromEntries(form)).toEqual({
      username: "sandbox",
      to: "+237600000001",
      message: "Code 123456",
      from: "ROUVIX",
    });
  });

  test("a refused recipient is a non-retryable error", async () => {
    const { send } = sender(() => answer("InvalidPhoneNumber"));
    const error = await send(message).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SmsSendError);
    expect((error as SmsSendError).retryable).toBe(false);
  });

  test("a 5xx or a 429 is retryable, a 4xx is not", async () => {
    for (const [status, retryable] of [
      [503, true],
      [429, true],
      [401, false],
    ] as const) {
      const { send } = sender(() => new Response("", { status }));
      const error = await send(message).catch((e: unknown) => e);
      expect((error as SmsSendError).retryable).toBe(retryable);
    }
  });

  test("a provider that does not answer is a retryable error", async () => {
    const { send } = sender(() => {
      throw new Error("network");
    });
    const error = await send(message).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SmsSendError);
    expect((error as SmsSendError).retryable).toBe(true);
  });

  test("an answer that is no JSON is a retryable error, not a bare SyntaxError", async () => {
    const { send } = sender(() => new Response("<html>", { status: 200 }));
    const error = await send(message).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SmsSendError);
    expect((error as SmsSendError).retryable).toBe(true);
  });
});

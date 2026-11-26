import { expect, test } from "bun:test";
import { logSmsSender } from "./log-sms-sender";

test("prints the text and masks the number", async () => {
  const lines: string[] = [];
  await logSmsSender((line) => lines.push(line)).send({
    to: "+237600000001",
    text: "Code 123456",
    countryCode: "CM",
  });
  expect(lines).toEqual(["[sms] to +237••••01 (CM): Code 123456"]);
});

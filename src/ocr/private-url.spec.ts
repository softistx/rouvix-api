import { describe, expect, test } from "bun:test";
import { isPrivateServiceUrl } from "./private-url";

describe("isPrivateServiceUrl", () => {
  test("a container name, localhost, a loopback or private address", () => {
    for (const url of [
      "http://rouvix-ocr:8884",
      "http://ocr:8884/",
      "http://localhost:8884",
      "http://127.0.0.1:8884",
      "http://10.0.3.7:8884",
      "http://172.20.0.5:8884",
      "http://192.168.1.10",
      "http://[::1]:8884",
      "http://[fd12:3456::1]:8884",
    ]) {
      expect(isPrivateServiceUrl(url)).toBe(true);
    }
  });

  test("never a host across the internet, nor anything but http(s)", () => {
    for (const url of [
      "https://ocr.example.com",
      "http://api.ocr-provider.test/v1",
      "http://8.8.8.8",
      "http://172.32.0.1",
      "http://[2001:db8::1]",
      "ftp://ocr:21",
      "http://user:secret@ocr:8884",
      "file:///etc/passwd",
      "not a url",
    ]) {
      expect(isPrivateServiceUrl(url)).toBe(false);
    }
  });
});

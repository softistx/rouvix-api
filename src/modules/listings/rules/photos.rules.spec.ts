import { describe, expect, test } from "bun:test";
import { closingPhotos, processesAgain, publicPhotoKeys } from "./photos.rules";

const K1 = "00000000-0000-4000-8000-000000000001";
const K2 = "00000000-0000-4000-8000-000000000002";
const B2 = "00000000-0000-4000-8000-0000000000b2";
const plain = { key: K1, status: "READY" as const, blurredKey: null };
const idLike = { key: K2, status: "READY" as const, blurredKey: B2 };

describe("publicPhotoKeys", () => {
  test("an object's plain photo as it is, an ID-like one blurred, a pending one not at all", () => {
    const pending = { ...plain, key: K2, status: "PENDING" as const };
    expect(
      publicPhotoKeys({ documentType: null, photos: [plain, idLike, pending] }),
    ).toEqual({ photoKeys: [K1], blurredPhotoKeys: [B2] });
  });

  test("a document's photos never as they are", () => {
    expect(
      publicPhotoKeys({ documentType: "CNI", photos: [plain, idLike] }),
    ).toEqual({ photoKeys: [], blurredPhotoKeys: [B2] });
  });
});

describe("closingPhotos", () => {
  test("an object's photo never checked goes too: it could be an ID's", () => {
    const pending = { ...plain, status: "PENDING" as const };
    expect(
      closingPhotos({ documentType: null, photos: [pending] }).gone,
    ).toEqual([pending]);
  });

  test("a document's all go, an object's ID-like ones only", () => {
    expect(
      closingPhotos({ documentType: "CNI", photos: [plain, idLike] }),
    ).toEqual({ kept: [], gone: [plain, idLike] });
    expect(
      closingPhotos({ documentType: null, photos: [plain, idLike] }),
    ).toEqual({ kept: [plain], gone: [idLike] });
  });
});

describe("processesAgain", () => {
  test("a changed document type, or a document losing a photo", () => {
    expect(
      processesAgain(
        { documentType: "CNI" },
        { documentType: "PASSPORT" },
        false,
      ),
    ).toBe(true);
    expect(
      processesAgain({ documentType: null }, { documentType: "CNI" }, false),
    ).toBe(true);
    expect(
      processesAgain({ documentType: "CNI" }, { documentType: "CNI" }, true),
    ).toBe(true);
    expect(
      processesAgain({ documentType: "CNI" }, { documentType: "CNI" }, false),
    ).toBe(false);
    expect(processesAgain({ documentType: null }, {}, true)).toBe(false);
  });
});

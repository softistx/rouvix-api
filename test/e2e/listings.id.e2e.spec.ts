import { beforeEach, describe, expect, test } from "bun:test";
import { type AuthApp, authApp } from "~/auth";
import { codeOf } from "~/codes";
import { clearDatabase, resetConfig } from "~/db";
import { fakeE164, signedIn } from "~/fixtures";
import { graphql } from "~/generated/graphql";
import { documentContent, photoOf } from "~/listings";
import { fakeCniLines } from "~/ocr";
import { decodePng, sharpness } from "~/png";

// A finder declares a found CNI with its photo -> the server's own OCR reads
// it and the photo is blurred whole -> a visitor reads the type, the country,
// the masked number, the holder hint and the blurred copy, never the photo ->
// the finder closes it and nothing of the ID is left. Through the REAL janus,
// the GraphQL endpoint and the media routes over the in-memory bucket.

const DECLARE_DOCUMENT_MUTATION = graphql(`
  mutation DeclareDocument($input: DeclareListingInput!) {
    declareListing(input: $input) { id status version }
  }
`);

const MY_DOCUMENT_QUERY = graphql(`
  query MyDocument($id: ID!) {
    myListing(id: $id) {
      status
      maskedNumber
      holderHint
      photos { key status blurredKey }
    }
  }
`);

const PUBLIC_DOCUMENT_QUERY = graphql(`
  query PublicDocument($id: ID!) {
    listing(id: $id) {
      documentType
      countryCode
      title
      photoKeys
      blurredPhotoKeys
      maskedNumber
      holderHint
    }
  }
`);

const CLOSE_DOCUMENT_MUTATION = graphql(`
  mutation CloseDocument($id: ID!) {
    closeListing(id: $id, reason: RECOVERED) { status photos { key } maskedNumber }
  }
`);

let kit: AuthApp;
beforeEach(async () => {
  await clearDatabase();
  await resetConfig();
  kit = authApp();
  kit.ocr.answer(fakeCniLines());
});

const media = (path: string, token?: string) =>
  kit.app.fetch(
    new Request(`http://localhost/media/${path}`, {
      headers: {
        "x-rouvix-client": "spec",
        ...(token && { authorization: `Bearer ${token}` }),
      },
    }),
  );

describe("a found ID document", () => {
  test("is shown blurred and masked to a visitor, whole to its finder, and leaves nothing once closed", async () => {
    const finder = await signedIn(kit, { phone: fakeE164(1) });
    const key = await photoOf(kit, finder.token);
    const as = kit.client(finder.token);
    const declared = await as.query(DECLARE_DOCUMENT_MUTATION, {
      variables: {
        input: {
          kind: "FOUND",
          content: documentContent({ photoKeys: [key] }),
          publish: true,
        },
      },
    });
    const id = declared.data?.declareListing.id as string;
    // Not public until its photo is processed.
    expect(declared.data?.declareListing.status).toBe("PENDING");
    expect(
      codeOf(
        await kit.client().query(PUBLIC_DOCUMENT_QUERY, { variables: { id } }),
      ),
    ).toBe("listings.errors.listing-not-found");
    await kit.auth.background.settled();

    const mine = (await as.query(MY_DOCUMENT_QUERY, { variables: { id } })).data
      ?.myListing;
    expect(mine).toMatchObject({
      status: "OPEN",
      maskedNumber: "99••••••••",
      holderHint: "Jean E.",
      photos: [{ key, status: "READY" }],
    });
    const blurredKey = mine?.photos[0]?.blurredKey as string;

    const seen = (
      await kit.client().query(PUBLIC_DOCUMENT_QUERY, { variables: { id } })
    ).data?.listing;
    expect(seen).toEqual({
      documentType: "CNI",
      countryCode: "CM",
      title: null,
      photoKeys: [],
      blurredPhotoKeys: [blurredKey],
      maskedNumber: "99••••••••",
      holderHint: "Jean E.",
    });

    // The visitor gets the blurred copy, never the photo; the finder both.
    const copy = await media(`listing-blurred/${blurredKey}`);
    expect(copy.status).toBe(200);
    expect(copy.headers.get("content-type")).toBe("image/webp");
    const png = await new Bun.Image(await copy.bytes()).png().bytes();
    expect(sharpness(decodePng(png))).toBeLessThan(1);
    expect((await media(`listing-photos/${key}/full`)).status).toBe(404);
    expect(
      (await media(`listing-photos/${key}/full`, finder.token)).status,
    ).toBe(200);

    const closed = await as.query(CLOSE_DOCUMENT_MUTATION, {
      variables: { id },
    });
    expect(closed.data?.closeListing).toEqual({
      status: "CLOSED",
      photos: [],
      maskedNumber: null,
    });
    expect((await media(`listing-blurred/${blurredKey}`)).status).toBe(404);
    expect(
      (await media(`listing-photos/${key}/full`, finder.token)).status,
    ).toBe(404);
    expect(kit.storage.objects.size).toBe(0);
  });

  test("the blurred kind takes no upload", async () => {
    const { token } = await signedIn(kit);
    const response = await kit.app.fetch(
      new Request("http://localhost/media/listing-blurred", {
        method: "PUT",
        headers: {
          "content-type": "image/webp",
          "content-length": "4",
          authorization: `Bearer ${token}`,
          "x-rouvix-client": "spec",
        },
        body: new Uint8Array([1, 2, 3, 4]),
      }),
    );
    expect(response.status).toBe(403);
    expect(kit.storage.objects.size).toBe(0);
  });
});

import { beforeEach, describe, expect, test } from "bun:test";
import { createMemoryMailer } from "@softistx/mail";
import { AccountsService } from "@/modules/accounts";
import { type AuthApp, authApp } from "~/auth";
import { codeOf } from "~/codes";
import { clearDatabase } from "~/db";
import { fakeE164, signedIn } from "~/fixtures";
import { graphql } from "~/generated/graphql";

// The viewer, the roles and the error catalogue, through the REAL janus.

const VIEWER_QUERY = graphql(`
  query ViewerQuery {
    viewer {
      roles
      sessionExpiresAt
      account {
        id
        displayName
        phone
        locale
        countryCode
        trustScore
        finderBadge
        suspendedAt
      }
    }
  }
`);

const ERROR_CATALOGUE_QUERY = graphql(`
  query ErrorCatalogueQuery($language: Language) {
    errorCatalogue(language: $language) {
      language
      version
      messages {
        code
        message
        params {
          name
          kind
        }
      }
    }
    errorCatalogueVersion(language: $language)
  }
`);

const CREATE_ORGANISATION_MUTATION = graphql(`
  mutation CreateAnOrganisation($input: CreateOrganisationInput!) {
    createOrganisation(input: $input) {
      slug
    }
  }
`);

let kit: AuthApp;
beforeEach(async () => {
  await clearDatabase();
  kit = authApp();
});

describe("viewer", () => {
  test("is null for an anonymous request", async () => {
    const result = await kit.client().query(VIEWER_QUERY);
    expect(result.errors).toBeUndefined();
    expect(result.data?.viewer).toBeNull();
  });

  test("is the signed-in account, with its own whole phone, as a USER", async () => {
    const { account, token } = await signedIn(kit, { name: "Aïcha" });
    const result = await kit.client(token).query(VIEWER_QUERY);
    expect(result.data?.viewer).toMatchObject({
      roles: ["USER"],
      account: {
        id: account.id,
        displayName: "Aïcha",
        phone: fakeE164(1),
        locale: "FR",
        countryCode: "CM",
        trustScore: 50,
        finderBadge: false,
        suspendedAt: null,
      },
    });
    expect(result.data?.viewer?.sessionExpiresAt).not.toBeNull();
  });

  test("a platform admin made by the script holds its roles", async () => {
    const accounts = new AccountsService(kit.auth, {
      sms: kit.sms,
      mailer: createMemoryMailer(),
    });
    await accounts.ensurePlatformAdmin({ phone: fakeE164(7), name: "Owner" });
    const { token } = await signedIn(kit, { phone: fakeE164(7) });
    const result = await kit.client(token).query(VIEWER_QUERY);
    expect(result.data?.viewer?.roles).toEqual([
      "USER",
      "MODERATOR",
      "PLATFORM_ADMIN",
    ]);
    expect(kit.sms.sent).toEqual([]);
  });

  test("a suspended account is still told so, and passes no guard", async () => {
    const { account, token } = await signedIn(kit);
    await kit.auth.accounts.update(account, {
      suspendedAt: "2026-11-25T10:00:00.000Z",
    });
    const result = await kit.client(token).query(VIEWER_QUERY);
    expect(result.data?.viewer?.account.suspendedAt).toBe(
      "2026-11-25T10:00:00.000Z",
    );
    const refused = await kit
      .client(token)
      .query(CREATE_ORGANISATION_MUTATION, {
        variables: {
          input: {
            name: "Mairie",
            kind: "TOWN_HALL",
            slug: "mairie",
            city: "Douala",
          },
        },
      });
    expect(codeOf(refused)).toBe("accounts.errors.suspended");
  });

  test("a token the store does not know is an anonymous request", async () => {
    const result = await kit.client("not-a-session").query(VIEWER_QUERY);
    expect(result.data?.viewer).toBeNull();
  });
});

describe("errorCatalogue", () => {
  test("serves every code in a language, public, with the arguments of each message", async () => {
    const result = await kit
      .client()
      .query(ERROR_CATALOGUE_QUERY, { variables: { language: "EN" } });
    expect(result.errors).toBeUndefined();
    const catalogue = result.data?.errorCatalogue;
    expect(catalogue?.language).toBe("EN");
    const slug = catalogue?.messages.find(
      (m) => m.code === "organisations.errors.slug-taken",
    );
    expect(slug?.message).toContain("{slug}");
    expect(slug?.params).toEqual([{ name: "slug", kind: "TEXT" }]);
    expect(result.data?.errorCatalogueVersion).toBe(
      catalogue?.version as string,
    );
  });

  test("answers in the request's language without an argument", async () => {
    const fr = await kit.client(null, "fr").query(ERROR_CATALOGUE_QUERY);
    const en = await kit.client(null, "en").query(ERROR_CATALOGUE_QUERY);
    expect(fr.data?.errorCatalogue.language).toBe("FR");
    expect(en.data?.errorCatalogue.language).toBe("EN");
    expect(fr.data?.errorCatalogue.version).not.toBe(
      en.data?.errorCatalogue.version as string,
    );
  });
});

describe("a refusal is worded in the request's language", () => {
  test("French by default, English on Accept-Language", async () => {
    const asFrench = await kit.client().query(CREATE_ORGANISATION_MUTATION, {
      variables: {
        input: {
          name: "Mairie",
          kind: "TOWN_HALL",
          slug: "mairie",
          city: "Douala",
        },
      },
    });
    expect(asFrench.errors?.[0]?.message).toBe(
      "Connectez-vous pour continuer.",
    );
    const asEnglish = await kit
      .client(null, "en")
      .query(CREATE_ORGANISATION_MUTATION, {
        variables: {
          input: {
            name: "Mairie",
            kind: "TOWN_HALL",
            slug: "mairie",
            city: "Douala",
          },
        },
      });
    expect(asEnglish.errors?.[0]?.message).toBe("Sign in to continue.");
  });

  test("an input past its @constraint is one validation.errors.invalid-input, on its path", async () => {
    const { token } = await signedIn(kit);
    const result = await kit.client(token).query(CREATE_ORGANISATION_MUTATION, {
      variables: {
        input: {
          name: "M",
          kind: "TOWN_HALL",
          slug: "Bad Slug",
          city: "Douala",
        },
      },
    });
    expect(codeOf(result)).toBe("validation.errors.invalid-input");
    expect(result.status).toBe(400);
    const fields = result.errors?.[0]?.extensions?.["fields"] as {
      path: string;
      code: string;
    }[];
    expect(fields.map((f) => f.path).sort()).toEqual(["name", "slug"]);
  });

  test("a taken slug is a field refusal with its param", async () => {
    const { token } = await signedIn(kit);
    const input = {
      name: "Mairie",
      kind: "TOWN_HALL" as const,
      slug: "mairie",
      city: "Douala",
    };
    await kit
      .client(token)
      .query(CREATE_ORGANISATION_MUTATION, { variables: { input } });
    const other = await signedIn(kit, { phone: fakeE164(2) });
    const result = await kit
      .client(other.token)
      .query(CREATE_ORGANISATION_MUTATION, { variables: { input } });
    expect(codeOf(result)).toBe("organisations.errors.slug-taken");
    expect(result.status).toBe(409);
    expect(result.errors?.[0]?.message).toContain("mairie");
  });
});

import { beforeEach, describe, expect, test } from "bun:test";
import { viewerOf } from "@/auth/access";
import { mongo } from "@/config/db";
import { scoped } from "@/tenancy";
import { type AuthApp, authApp } from "~/auth";
import { clearDatabase } from "~/db";
import { fakeE164, signedIn } from "~/fixtures";
import { refusal } from "~/refusals";
import { OrganisationRelations } from "../organisations.janus";
import { OrganisationsService } from "./organisations.service";

let kit: AuthApp;
let service: OrganisationsService;

beforeEach(async () => {
  await clearDatabase();
  kit = authApp();
  service = new OrganisationsService(
    mongo,
    kit.auth,
    new OrganisationRelations(kit.auth),
  );
});

const input = (slug: string) => ({
  name: `Mairie ${slug}`,
  kind: "TOWN_HALL" as const,
  slug,
  city: "Douala",
});

const viewerAt = async (n: number) =>
  viewerOf((await signedIn(kit, { phone: fakeE164(n) })).account);

describe("create", () => {
  test("makes the organisation, its creator becoming an active admin of it", async () => {
    const viewer = await viewerAt(1);
    const organisation = await service.create(viewer, input("mairie-douala"));
    expect(organisation).toMatchObject({
      slug: "mairie-douala",
      countryCode: "CM",
      verifiedAt: null,
    });
    const members = await scoped(mongo.db.members, organisation._id).findMany(
      {},
    );
    expect(members).toMatchObject([
      {
        accountId: viewer.id,
        role: "ADMIN",
        status: "ACTIVE",
        phone: viewer.phone,
      },
    ]);
    expect(await service.ofViewer(viewer)).toMatchObject([
      { role: "ADMIN", organisation: { slug: "mairie-douala" } },
    ]);
  });

  test("a taken slug is refused on `slug`, and grants nothing", async () => {
    const first = await viewerAt(1);
    const second = await viewerAt(2);
    await service.create(first, input("mairie"));
    const error = await refusal(service.create(second, input("mairie")));
    expect(error.extensions["code"]).toBe("organisations.errors.slug-taken");
    expect(await service.ofViewer(second)).toEqual([]);
  });

  test("two creations of one slug at once make one organisation, the loser holds no right", async () => {
    const [a, b] = [await viewerAt(1), await viewerAt(2)];
    const settled = await Promise.allSettled([
      service.create(a, input("race")),
      service.create(b, input("race")),
    ]);
    expect(settled.filter((s) => s.status === "fulfilled")).toHaveLength(1);
    expect(await mongo.db.organisations.count({ slug: "race" })).toBe(1);
    const held = [
      ...(await service.ofViewer(a)),
      ...(await service.ofViewer(b)),
    ];
    expect(held).toHaveLength(1);
  });
});

describe("reserved slugs", () => {
  test("a slug that is a UI route is refused before anything is granted", async () => {
    const viewer = await viewerAt(1);
    const error = await refusal(service.create(viewer, input("settings")));
    expect(error.extensions["code"]).toBe("organisations.errors.slug-reserved");
    expect(await service.ofViewer(viewer)).toEqual([]);
    expect(await mongo.db.organisations.count({})).toBe(0);
  });
});

describe("bySlug and ofViewer", () => {
  test("finds an organisation by slug, and none by a wrong one", async () => {
    await service.create(await viewerAt(1), input("mairie"));
    expect((await service.bySlug("mairie"))?.slug).toBe("mairie");
    expect(await service.bySlug("autre")).toBeUndefined();
  });

  test("lists only the organisations the viewer works in, by name", async () => {
    const viewer = await viewerAt(1);
    const other = await viewerAt(2);
    await service.create(viewer, input("b-ville"));
    await service.create(viewer, input("a-ville"));
    await service.create(other, input("c-ville"));
    const held = await service.ofViewer(viewer);
    expect(held.map((h) => h.organisation.slug)).toEqual([
      "a-ville",
      "b-ville",
    ]);
    expect(await service.ofViewer(await viewerAt(3))).toEqual([]);
  });
});

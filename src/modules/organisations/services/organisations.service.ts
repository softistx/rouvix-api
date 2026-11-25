import { ConflictError, type ReadDocumentOf } from "@softistx/mongo";
import { ObjectId } from "mongodb";
import type { Viewer } from "@/auth/access";
import type { Auth } from "@/auth/auth";
import type { AppMongo } from "@/config/db";
import { retryWriteConflicts } from "@/shared/locked";
import { scoped } from "@/tenancy";
import type { OrganisationKind, organisations } from "../models";
import { slugTaken, staleVersion } from "../organisations.errors";
import type { OrganisationRelations } from "../organisations.janus";

export type OrganisationDocument = ReadDocumentOf<typeof organisations>;

export interface CreateOrganisationInput {
  name: string;
  kind: OrganisationKind;
  slug: string;
  city: string;
}

// The organisations themselves: the tenants, so the one collection read
// without an organisation scope. An account makes its own: it becomes its
// first administrator.
export class OrganisationsService {
  constructor(
    private readonly mongo: AppMongo,
    private readonly auth: Pick<Auth, "permissions">,
    private readonly relations: OrganisationRelations,
  ) {}

  bySlug(slug: string) {
    return this.mongo.db.organisations.findFirst({ slug });
  }

  // The organisation, its slug checked first (a taken one grants nothing),
  // its first administrator's relation granted next, the documents written in
  // one transaction last; whatever fails after the grant undoes it.
  async create(viewer: Viewer, input: CreateOrganisationInput) {
    if (await this.bySlug(input.slug)) throw slugTaken(input.slug);
    const _id = new ObjectId();
    await this.relations.hold(_id, viewer.id, "ADMIN");
    try {
      return await retryWriteConflicts(
        () => this.write(viewer, _id, input),
        staleVersion,
      );
    } catch (error) {
      await this.relations.release(_id, viewer.id, "ADMIN");
      if (error instanceof ConflictError) throw slugTaken(input.slug);
      throw error;
    }
  }

  private write(viewer: Viewer, _id: ObjectId, input: CreateOrganisationInput) {
    return this.mongo.transaction(async (tx) => {
      const organisation = await tx.db.organisations.create({
        _id,
        ...input,
        countryCode: viewer.countryCode,
      });
      await scoped(tx.db.members, _id).create({
        phone: viewer.phone,
        accountId: viewer.id,
        role: "ADMIN",
        status: "ACTIVE",
        invitedBy: viewer.id,
      });
      return organisation;
    });
  }

  // The organisations the viewer works in, each with their role: janus's
  // `work` permission lists them (an admin included), `manage` tells the
  // administrators. Pages of 100 ids, so the cost is a few reads.
  async ofViewer(viewer: Viewer) {
    const subject = { type: viewer.type, id: viewer.id } as const;
    const [working, managing] = await Promise.all([
      this.ids(subject, "work"),
      this.ids(subject, "manage"),
    ]);
    if (working.length === 0) return [];
    const found = await this.mongo.db.organisations.findMany({
      filter: { _id: { $in: working.map((id) => new ObjectId(id)) } },
      sort: { name: 1 },
    });
    return found.map((organisation) => ({
      organisation,
      role: managing.includes(organisation._id.toHexString())
        ? ("ADMIN" as const)
        : ("AGENT" as const),
    }));
  }

  private async ids(
    subject: { type: "user"; id: string },
    permission: "work" | "manage",
  ) {
    const ids: string[] = [];
    let cursor: string | undefined;
    for (;;) {
      const page: { items: readonly string[]; nextCursor: string | null } =
        await this.auth.permissions.list(subject, permission, "organisation", {
          limit: 100,
          ...(cursor !== undefined && { after: cursor }),
        });
      ids.push(...page.items);
      if (page.nextCursor === null) return ids;
      cursor = page.nextCursor;
    }
  }
}

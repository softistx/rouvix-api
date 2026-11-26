import {
  scopeToTenant,
  type TenantOwned,
  type Scoped as TenantScoped,
  type TypedCollection,
  tenantFieldOf,
} from "@softistx/mongo";
import type { ObjectId } from "mongodb";

// The tenant of this application is the organisation: the field every
// organisation-owned collection declares, first in its schema:
// `schema: z.object({ _id: id(), ...tenantField, … })`. Everything else (an
// account, a listing, a claim) lives in the platform space and carries none.
export const tenantField = tenantFieldOf("organisationId");

export type OrganisationField = "organisationId";

/**
 * One collection, seen from one organisation (`scopeToTenant` of
 * @softistx/mongo on the `organisationId` field). A service reads and writes
 * through this, never through the collection itself, so no query builds its
 * own organisation filter and another organisation's document is not found.
 */
export type Scoped<Def> = TenantScoped<Def, OrganisationField>;

export function scoped<Def>(
  collection: TypedCollection<TenantOwned<Def, OrganisationField>>,
  organisationId: ObjectId,
): Scoped<Def> {
  return scopeToTenant<Def, OrganisationField>(collection, organisationId, {
    field: "organisationId",
  });
}

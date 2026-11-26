import type { ObjectId } from "mongodb";
import type { AccountType, Auth } from "./auth";

// Who sends the request: the signed-in janus account, or null. `id` is the
// account's id, a UUIDv7, which every write stamps as its actor. `phone` is
// the account's own: it never leaves the API but to its holder.
export interface Viewer {
  id: string;
  type: AccountType;
  name: string;
  phone: string;
  locale: "fr" | "en";
  countryCode: string;
  trustScore: number;
  finderBadge: boolean;
  suspendedAt: Date | null;
  // The account's own address, and when it was proved (spec §5.1).
  email: string | null;
  emailVerifiedAt: Date | null;
  createdAt: Date;
  // When the request's session ends, after any renewal this request made; null
  // when no session was read (a fake in a spec).
  sessionExpiresAt?: Date | null;
}

// What a viewer may do, from janus's relations: `platform:main` holds the
// platform's admins and moderators, `organisation:<id>` its admins and agents.
// An admin is an agent too, a platform admin a moderator. `denyAll` answers no
// to everything; a spec gives its own.
export interface Access {
  isOrgAgent(viewer: Viewer, organisationId: ObjectId): Promise<boolean>;
  isOrgAdmin(viewer: Viewer, organisationId: ObjectId): Promise<boolean>;
  isModerator(viewer: Viewer): Promise<boolean>;
  isPlatformAdmin(viewer: Viewer): Promise<boolean>;
}

export const denyAll: Access = {
  isOrgAgent: async () => false,
  isOrgAdmin: async () => false,
  isModerator: async () => false,
  isPlatformAdmin: async () => false,
};

// How the request's viewer is read: null for an anonymous request. A store
// that cannot answer rejects, and the request is answered 503.
export type ResolveViewer = (request: Request) => Promise<Viewer | null>;
export const anonymous: ResolveViewer = async () => null;

// The objects janus's permissions are asked about, and the viewer as subject.
export const PLATFORM = { type: "platform", id: "main" } as const;
export const organisationObject = (organisationId: ObjectId | string) =>
  ({
    type: "organisation",
    id:
      typeof organisationId === "string"
        ? organisationId
        : organisationId.toHexString(),
  }) as const;
export const subjectOf = (viewer: Pick<Viewer, "id" | "type">) =>
  ({ type: viewer.type, id: viewer.id }) as const;

// `Access` answered by janus's permissions.
export function janusAccess(auth: Pick<Auth, "permissions">): Access {
  const { permissions } = auth;
  return {
    isOrgAgent: (viewer, id) =>
      permissions.can(subjectOf(viewer), "work", organisationObject(id)),
    isOrgAdmin: (viewer, id) =>
      permissions.can(subjectOf(viewer), "manage", organisationObject(id)),
    isModerator: (viewer) =>
      permissions.can(subjectOf(viewer), "moderate", PLATFORM),
    isPlatformAdmin: (viewer) =>
      permissions.can(subjectOf(viewer), "manage", PLATFORM),
  };
}

// A janus account as the API's viewer, with the session it signed in with.
export const viewerOf = (
  user: {
    id: string;
    type: AccountType;
    name: string;
    phone: string;
    locale: "fr" | "en";
    countryCode: string;
    trustScore: number;
    finderBadge: boolean;
    suspendedAt: string | null;
    email: string | null;
    emailVerifiedAt: string | null;
    createdAt: Date;
  },
  session?: { expiresAt: Date },
): Viewer => ({
  id: user.id,
  type: user.type,
  name: user.name,
  phone: user.phone,
  locale: user.locale,
  countryCode: user.countryCode,
  trustScore: user.trustScore,
  finderBadge: user.finderBadge,
  suspendedAt: user.suspendedAt === null ? null : new Date(user.suspendedAt),
  email: user.email,
  emailVerifiedAt:
    user.emailVerifiedAt === null ? null : new Date(user.emailVerifiedAt),
  createdAt: user.createdAt,
  sessionExpiresAt: session?.expiresAt ?? null,
});

// The viewer janus authenticates: `Authorization: Bearer`, then
// `X-Session-Token`, then the session cookie: the first one present wins.
export function janusViewer(auth: Pick<Auth, "accounts">): ResolveViewer {
  return async (request) => {
    const current = await auth.accounts.authenticate(request);
    return current && viewerOf(current.user, current.session);
  };
}

// The clock a service reads, passed to it by the registry (never `new Date()`
// in a service) so a spec can fix and move it.
export type Now = () => Date;

export const DAY_MS = 24 * 60 * 60 * 1000;

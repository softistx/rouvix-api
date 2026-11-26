import { accounts } from "./accounts";
import { config } from "./config";
import { listings } from "./listings";
import { organisations } from "./organisations";
import { search } from "./search";
import { translationResolvers } from "./translations";

// The registry: every module's resolvers, merged by graxia per type and field.
export const resolvers = [
  accounts,
  config,
  listings,
  organisations,
  search,
  translationResolvers,
];

export { type ServiceDeps, type Services, services } from "./services";

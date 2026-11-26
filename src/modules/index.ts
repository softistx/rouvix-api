import { accounts } from "./accounts";
import { ai } from "./ai";
import { config } from "./config";
import { listings } from "./listings";
import { notifications } from "./notifications";
import { organisations } from "./organisations";
import { search } from "./search";
import { translationResolvers } from "./translations";

// The registry: every module's resolvers, merged by graxia per type and field.
export const resolvers = [
  accounts,
  ai,
  config,
  listings,
  notifications,
  organisations,
  search,
  translationResolvers,
];

export { type ServiceDeps, type Services, services } from "./services";

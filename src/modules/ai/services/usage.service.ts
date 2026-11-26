import type { AppMongo } from "@/config/db";
import type { Now } from "@/shared/dates";

const DUPLICATE_KEY = 11000;

export interface UsageDeps {
  now: Now;
  // Claude calls a day for the whole platform (CLAUDE_DAILY_CAP).
  dailyCap: number;
}

// The day's use of Claude (spec §5.5): every call is counted before it is made
// and refused past the cap, and its tokens are added once it answers. One
// document per UTC day, moved by atomic increments: concurrent requests cannot
// pass the cap together.
export class UsageService {
  constructor(
    private readonly mongo: AppMongo,
    private readonly deps: UsageDeps,
  ) {}

  private idOf() {
    return `claude:${this.deps.now().toISOString().slice(0, 10)}`;
  }

  // Counts one call; false when the day's cap is reached (nothing is counted).
  // The filter matches no document once `calls` hit the cap, so the upsert then
  // tries to insert the day's own `_id` again: a duplicate key says "full".
  async claim(): Promise<boolean> {
    const { dailyCap } = this.deps;
    if (dailyCap <= 0) return false;
    // Twice: on the day's first calls, two inserts race and the loser sees a
    // duplicate key although the cap is far; its second try finds the document.
    for (let attempt = 1; ; attempt += 1) {
      try {
        await this.mongo.db.aiUsage.raw.updateOne(
          { _id: this.idOf(), calls: { $lt: dailyCap } },
          {
            $inc: { calls: 1 },
            $setOnInsert: { inputTokens: 0, outputTokens: 0 },
          },
          { upsert: true },
        );
        return true;
      } catch (error) {
        if ((error as { code?: number }).code !== DUPLICATE_KEY) throw error;
        if (attempt >= 2) return false;
      }
    }
  }

  // Adds the tokens of a call that answered.
  async record(usage: { inputTokens: number; outputTokens: number }) {
    await this.mongo.db.aiUsage.raw.updateOne(
      { _id: this.idOf() },
      {
        $inc: {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
        },
      },
    );
  }

  // What the day has used so far.
  async today() {
    const found = await this.mongo.db.aiUsage.raw.findOne({ _id: this.idOf() });
    return {
      calls: found?.calls ?? 0,
      inputTokens: found?.inputTokens ?? 0,
      outputTokens: found?.outputTokens ?? 0,
    };
  }
}

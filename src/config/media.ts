import type { MediaBucket } from "@softistx/alxia-media";
import { noMediaBucket, s3MediaBucket } from "@/storage";
import { env } from "./env";

// The server's bucket: the S3 one where S3_* is set, else none (every media
// route answers 503 and photos cannot be declared).
export const serverMedia: MediaBucket =
  env.S3_ENDPOINT === undefined ||
  env.S3_BUCKET === undefined ||
  env.S3_ACCESS_KEY_ID === undefined ||
  env.S3_SECRET_ACCESS_KEY === undefined
    ? noMediaBucket
    : s3MediaBucket({
        bucket: env.S3_BUCKET,
        endpoint: env.S3_ENDPOINT,
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
        region: env.S3_REGION,
      });

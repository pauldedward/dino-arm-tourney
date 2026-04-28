import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { S3Client, CreateBucketCommand, HeadBucketCommand } from "@aws-sdk/client-s3";

const here = dirname(fileURLToPath(import.meta.url));
for (const line of readFileSync(join(here, "..", ".env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const name = process.env.R2_PRIVATE_BUCKET;
const client = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

try {
  await client.send(new CreateBucketCommand({ Bucket: name }));
  console.log(`[ok] created bucket ${name}`);
} catch (err) {
  console.error(`[fail] create ${name}:`, err?.name, err?.$metadata?.httpStatusCode, err?.message);
  process.exit(1);
}

await client.send(new HeadBucketCommand({ Bucket: name }));
console.log(`[ok] HEAD ${name}`);

// Quick R2 connectivity probe. Reads .env.local, tries a small PutObject.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { S3Client, PutObjectCommand, HeadBucketCommand } from "@aws-sdk/client-s3";

const here = dirname(fileURLToPath(import.meta.url));
const envPath = join(here, "..", ".env.local");
for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const endpoint = `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
console.log("endpoint:", endpoint);
console.log("public bucket:", process.env.R2_PUBLIC_BUCKET);
console.log("private bucket:", process.env.R2_PRIVATE_BUCKET);

const client = new S3Client({
  region: "auto",
  endpoint,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

async function probe(bucket) {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    console.log(`[ok] HEAD ${bucket}`);
  } catch (err) {
    console.error(`[fail] HEAD ${bucket}:`, err?.name, err?.$metadata?.httpStatusCode, err?.message);
    return;
  }
  try {
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: "probe/test.txt",
        Body: Buffer.from(`probe ${new Date().toISOString()}`),
        ContentType: "text/plain",
      })
    );
    console.log(`[ok] PUT ${bucket}/probe/test.txt`);
  } catch (err) {
    console.error(`[fail] PUT ${bucket}:`, err?.name, err?.$metadata?.httpStatusCode, err?.message);
  }
}

await probe(process.env.R2_PUBLIC_BUCKET);
await probe(process.env.R2_PRIVATE_BUCKET);

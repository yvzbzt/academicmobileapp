import { Queue } from "bullmq";
import { Redis } from "ioredis";
import mongoose from "mongoose";

async function main() {
  const mongodbUri = process.env.MONGODB_URI ?? "mongodb://localhost:27017/akademik_takvim_smoke";
  const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";

  const mongo = await mongoose.createConnection(mongodbUri, { serverSelectionTimeoutMS: 3000 }).asPromise();
  await mongo.db?.admin().ping();
  const collection = mongo.collection("infrastructure_smoke_checks");
  const inserted = await collection.insertOne({ checkedAt: new Date(), source: "smoke-infrastructure" });
  const found = await collection.findOne({ _id: inserted.insertedId });
  if (!found) throw new Error("MONGODB_SMOKE_READ_FAILED");

  const redis = new Redis(redisUrl, { maxRetriesPerRequest: null });
  await redis.ping();
  const queue = new Queue("infrastructure_smoke_queue", { connection: redis });
  const job = await queue.add("infrastructure_smoke_queue", { checkedAt: new Date().toISOString() }, { removeOnComplete: true, removeOnFail: true });
  if (!job.id) throw new Error("BULLMQ_SMOKE_ENQUEUE_FAILED");

  await queue.close();
  await redis.quit();
  await mongo.close();

  console.log(JSON.stringify({ mongodb: "ok", redis: "ok", bullmq: "ok", jobId: job.id }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

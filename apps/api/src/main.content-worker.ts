import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ContentIngestionWorkerModule } from "./modules/content-ingestion/content-ingestion-worker.module.js";

async function bootstrap(): Promise<void> {
  if (!process.env.MONGODB_URI?.trim()) {
    throw new Error("CONTENT_INGESTION_WORKER_ENVIRONMENT_INVALID: MONGODB_URI is required.");
  }
  const application = await NestFactory.createApplicationContext(ContentIngestionWorkerModule, { bufferLogs: true });
  application.enableShutdownHooks();
}

void bootstrap();

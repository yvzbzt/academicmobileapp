import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { assertValidEnvironment } from "./config/environment-validation.js";

async function bootstrap(): Promise<void> {
  assertValidEnvironment();
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.enableShutdownHooks();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true
    })
  );
  const defaultOrigins = [
    "http://localhost:3001",
    "http://localhost:3002",
    "http://localhost:3003",
    "http://localhost:3004"
  ];
  app.enableCors({
    origin: process.env.CORS_ORIGIN?.split(",") ?? defaultOrigins,
    credentials: true
  });

  const port = Number(process.env.PORT ?? process.env.API_PORT ?? 3000);
  await app.listen(port);
}

void bootstrap();

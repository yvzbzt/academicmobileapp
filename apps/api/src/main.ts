import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NextFunction, Request, Response } from "express";
import { AppModule } from "./app.module.js";
import { assertValidEnvironment } from "./config/environment-validation.js";

async function bootstrap(): Promise<void> {
  assertValidEnvironment();
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.getHttpAdapter().getInstance().disable("x-powered-by");
  app.use((request: Request, response: Response, next: NextFunction) => {
    const contentSecurityPolicy = request.method === "GET" && request.path === "/account-deletion"
      ? "default-src 'self'; base-uri 'none'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data:; script-src 'unsafe-inline'; style-src 'unsafe-inline'"
      : "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";
    response.setHeader("Content-Security-Policy", contentSecurityPolicy);
    response.setHeader("Cross-Origin-Resource-Policy", "same-site");
    response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("X-Frame-Options", "DENY");
    if (process.env.NODE_ENV === "production") {
      response.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    next();
  });
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

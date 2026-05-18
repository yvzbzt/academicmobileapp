import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { HealthController } from "./modules/health/health.controller.js";
import { InfrastructureHealthService } from "./modules/health/infrastructure-health.service.js";
import { BootstrapSeedService } from "./bootstrap/bootstrap-seed.service.js";
import { AuthController } from "./modules/auth/auth.controller.js";
import { AuthApplicationService } from "./modules/auth/auth-application.service.js";
import { EmailVerificationSenderService } from "./modules/auth/email-verification-sender.service.js";
import { InMemoryAuthRepository } from "./modules/auth/in-memory-auth.repository.js";
import { MongoAuthRepository } from "./modules/auth/mongo-auth.repository.js";
import { PasswordHasher } from "./modules/auth/password-hasher.js";
import { TokenService } from "./modules/auth/token.service.js";
import { JwtAuthGuard } from "./common/guards/jwt-auth.guard.js";
import { RateLimitGuard } from "./common/guards/rate-limit.guard.js";
import { InMemoryRateLimitStore, RedisRateLimitStore } from "./common/guards/rate-limit-store.js";
import { RolesGuard } from "./common/guards/roles.guard.js";
import { readRuntimeConfig } from "./config/runtime-config.js";
import { MongoConnectionService } from "./database/mongo-connection.service.js";
import { UsersController } from "./modules/users/users.controller.js";
import { UsersService } from "./modules/users/users.service.js";
import { AnnouncementsController } from "./modules/announcements/announcements.controller.js";
import { AnnouncementsService } from "./modules/announcements/announcements.service.js";
import { InMemoryAnnouncementRepository } from "./modules/announcements/in-memory-announcement.repository.js";
import { MongoAnnouncementRepository } from "./modules/announcements/mongo-announcement.repository.js";
import { AdminCatalogController } from "./modules/catalog/admin-catalog.controller.js";
import { CatalogController } from "./modules/catalog/catalog.controller.js";
import { CatalogService } from "./modules/catalog/catalog.service.js";
import { InMemoryCatalogRepository } from "./modules/catalog/in-memory-catalog.repository.js";
import { MongoCatalogRepository } from "./modules/catalog/mongo-catalog.repository.js";
import { CalendarController } from "./modules/calendars/calendar.controller.js";
import { CalendarService } from "./modules/calendars/calendar.service.js";
import { InMemoryCalendarRepository } from "./modules/calendars/in-memory-calendar.repository.js";
import { MongoCalendarRepository } from "./modules/calendars/mongo-calendar.repository.js";
import { AdminCalendarController } from "./modules/calendars/admin-calendar.controller.js";
import { AdminCalendarService } from "./modules/calendars/admin-calendar.service.js";
import { AdminPdfController } from "./modules/pdf/admin-pdf.controller.js";
import { InMemoryPdfRepository } from "./modules/pdf/in-memory-pdf.repository.js";
import { MongoPdfRepository } from "./modules/pdf/mongo-pdf.repository.js";
import { PdfProcessingService } from "./modules/pdf/pdf-processing.service.js";
import { NotificationsController } from "./modules/notifications/notifications.controller.js";
import { AdminNotificationOpsController } from "./modules/notifications/admin-notification-ops.controller.js";
import { InMemoryNotificationRepository } from "./modules/notifications/in-memory-notification.repository.js";
import { MongoNotificationRepository } from "./modules/notifications/mongo-notification.repository.js";
import { NotificationSchedulingService, NotificationsService } from "./modules/notifications/notifications.service.js";
import { NotificationWorkerService } from "./modules/notifications/notification-worker.service.js";
import { BullMqQueueService } from "./queue/bullmq-queue.service.js";
import { InMemoryQueueService } from "./queue/in-memory-queue.service.js";
import { AuditService } from "./modules/audit/audit.service.js";
import { InMemoryAuditRepository } from "./modules/audit/in-memory-audit.repository.js";
import { MongoAuditRepository } from "./modules/audit/mongo-audit.repository.js";
import { AdminAuditController } from "./modules/audit/admin-audit.controller.js";
import { FirebasePushSender } from "./modules/notifications/push-sender.service.js";

const runtimeConfig = readRuntimeConfig();

@Module({
  controllers: [HealthController, AuthController, UsersController, AnnouncementsController, CatalogController, AdminCatalogController, CalendarController, AdminCalendarController, AdminPdfController, NotificationsController, AdminNotificationOpsController, AdminAuditController],
  providers: [
    AuthApplicationService,
    EmailVerificationSenderService,
    UsersService,
    AnnouncementsService,
    CatalogService,
    CalendarService,
    AdminCalendarService,
    PdfProcessingService,
    NotificationsService,
    NotificationSchedulingService,
    NotificationWorkerService,
    InfrastructureHealthService,
    BootstrapSeedService,
    FirebasePushSender,
    AuditService,
    MongoConnectionService,
    PasswordHasher,
    TokenService,
    JwtAuthGuard,
    RolesGuard,
    RateLimitGuard,
    {
      provide: APP_GUARD,
      useExisting: RateLimitGuard
    },
    {
      provide: "AuthRepository",
      inject: [MongoConnectionService],
      useFactory: (mongo: MongoConnectionService) => runtimeConfig.repositoryMode === "mongo" ? new MongoAuthRepository(mongo) : new InMemoryAuthRepository()
    },
    {
      provide: "CatalogRepository",
      inject: [MongoConnectionService],
      useFactory: (mongo: MongoConnectionService) => runtimeConfig.repositoryMode === "mongo" ? new MongoCatalogRepository(mongo) : new InMemoryCatalogRepository()
    },
    {
      provide: "CalendarRepository",
      inject: [MongoConnectionService],
      useFactory: (mongo: MongoConnectionService) => runtimeConfig.repositoryMode === "mongo" ? new MongoCalendarRepository(mongo) : new InMemoryCalendarRepository()
    },
    {
      provide: "AnnouncementRepository",
      inject: [MongoConnectionService],
      useFactory: (mongo: MongoConnectionService) => runtimeConfig.repositoryMode === "mongo" ? new MongoAnnouncementRepository(mongo) : new InMemoryAnnouncementRepository()
    },
    {
      provide: "PdfRepository",
      inject: [MongoConnectionService],
      useFactory: (mongo: MongoConnectionService) => runtimeConfig.repositoryMode === "mongo" ? new MongoPdfRepository(mongo) : new InMemoryPdfRepository()
    },
    {
      provide: "NotificationRepository",
      inject: [MongoConnectionService],
      useFactory: (mongo: MongoConnectionService) => runtimeConfig.repositoryMode === "mongo" ? new MongoNotificationRepository(mongo) : new InMemoryNotificationRepository()
    },
    {
      provide: "QueueService",
      useFactory: () => runtimeConfig.queueMode === "bullmq" ? new BullMqQueueService(runtimeConfig.redisUrl) : new InMemoryQueueService()
    },
    {
      provide: "RateLimitStore",
      useFactory: () => runtimeConfig.rateLimitStoreMode === "redis" ? new RedisRateLimitStore(runtimeConfig.redisUrl) : new InMemoryRateLimitStore()
    },
    {
      provide: "REDIS_URL",
      useValue: process.env.REDIS_URL
    },
    {
      provide: "AuditRepository",
      inject: [MongoConnectionService],
      useFactory: (mongo: MongoConnectionService) => runtimeConfig.repositoryMode === "mongo" ? new MongoAuditRepository(mongo) : new InMemoryAuditRepository()
    },
    {
      provide: "PushSender",
      useExisting: FirebasePushSender
    }
  ]
})
export class AppModule {}

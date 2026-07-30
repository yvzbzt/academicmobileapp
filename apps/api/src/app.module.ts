import { Module, type Provider } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { HealthController } from "./modules/health/health.controller.js";
import { PublicPagesController } from "./modules/public/public-pages.controller.js";
import { AccountDeletionService } from "./modules/public/account-deletion.service.js";
import { InfrastructureHealthService } from "./modules/health/infrastructure-health.service.js";
import { BootstrapSeedService } from "./bootstrap/bootstrap-seed.service.js";
import { AuthController } from "./modules/auth/auth.controller.js";
import { AuthApplicationService } from "./modules/auth/auth-application.service.js";
import { EmailVerificationSenderService } from "./modules/auth/email-verification-sender.service.js";
import { FirebaseGoogleIdentityVerifier } from "./modules/auth/firebase-google-identity.verifier.js";
import { MongoAuthRepository } from "./modules/auth/mongo-auth.repository.js";
import { PasswordHasher } from "./modules/auth/password-hasher.js";
import { TokenService } from "./modules/auth/token.service.js";
import { JwtAuthGuard } from "./common/guards/jwt-auth.guard.js";
import { RateLimitGuard } from "./common/guards/rate-limit.guard.js";
import { InMemoryRateLimitStore, RedisRateLimitStore } from "./common/guards/rate-limit-store.js";
import { RolesGuard } from "./common/guards/roles.guard.js";
import { readRuntimeConfig } from "./config/runtime-config.js";
import { FirebaseAdminService } from "./database/firebase-admin.service.js";
import { MongoConnectionService } from "./database/mongo-connection.service.js";
import { AdminUsersController, UsersController } from "./modules/users/users.controller.js";
import { UsersService } from "./modules/users/users.service.js";
import { AdminAnnouncementsController, AnnouncementsController } from "./modules/announcements/announcements.controller.js";
import { AnnouncementIngestionService } from "./modules/announcements/announcement-ingestion.service.js";
import { AnnouncementsService } from "./modules/announcements/announcements.service.js";
import { MongoAnnouncementRepository } from "./modules/announcements/mongo-announcement.repository.js";
import { AdminCatalogController } from "./modules/catalog/admin-catalog.controller.js";
import { CatalogController } from "./modules/catalog/catalog.controller.js";
import { CatalogService } from "./modules/catalog/catalog.service.js";
import { MongoCatalogRepository } from "./modules/catalog/mongo-catalog.repository.js";
import { CalendarController } from "./modules/calendars/calendar.controller.js";
import { CalendarService } from "./modules/calendars/calendar.service.js";
import { MongoCalendarRepository } from "./modules/calendars/mongo-calendar.repository.js";
import { AdminCalendarController } from "./modules/calendars/admin-calendar.controller.js";
import { AdminCalendarService } from "./modules/calendars/admin-calendar.service.js";
import { CalendarIngestionService } from "./modules/calendars/calendar-ingestion.service.js";
import { AdminPdfController } from "./modules/pdf/admin-pdf.controller.js";
import { MongoPdfRepository } from "./modules/pdf/mongo-pdf.repository.js";
import { PdfOcrService } from "./modules/pdf/pdf-ocr.service.js";
import { PdfProcessingService } from "./modules/pdf/pdf-processing.service.js";
import { NotificationsController } from "./modules/notifications/notifications.controller.js";
import { AdminNotificationOpsController } from "./modules/notifications/admin-notification-ops.controller.js";
import { MongoNotificationRepository } from "./modules/notifications/mongo-notification.repository.js";
import { NotificationSchedulingService, NotificationsService } from "./modules/notifications/notifications.service.js";
import { NotificationWorkerService } from "./modules/notifications/notification-worker.service.js";
import { BullMqQueueService } from "./queue/bullmq-queue.service.js";
import { InMemoryQueueService } from "./queue/in-memory-queue.service.js";
import { AuditService } from "./modules/audit/audit.service.js";
import { MongoAuditRepository } from "./modules/audit/mongo-audit.repository.js";
import { AdminAuditController } from "./modules/audit/admin-audit.controller.js";
import { FirebasePushSender } from "./modules/notifications/push-sender.service.js";

const runtimeConfig = readRuntimeConfig();

const MONGO_REPOSITORY_PROVIDERS = [
  { provide: "AuthRepository", useClass: MongoAuthRepository },
  { provide: "CatalogRepository", useClass: MongoCatalogRepository },
  { provide: "CalendarRepository", useClass: MongoCalendarRepository },
  { provide: "AnnouncementRepository", useClass: MongoAnnouncementRepository },
  { provide: "PdfRepository", useClass: MongoPdfRepository },
  { provide: "NotificationRepository", useClass: MongoNotificationRepository },
  { provide: "AuditRepository", useClass: MongoAuditRepository }
] as const satisfies readonly Provider[];

@Module({
  controllers: [HealthController, PublicPagesController, AuthController, UsersController, AdminUsersController, AnnouncementsController, AdminAnnouncementsController, CatalogController, AdminCatalogController, CalendarController, AdminCalendarController, AdminPdfController, NotificationsController, AdminNotificationOpsController, AdminAuditController],
  providers: [
    AuthApplicationService,
    AccountDeletionService,
    EmailVerificationSenderService,
    FirebaseGoogleIdentityVerifier,
    UsersService,
    AnnouncementsService,
    AnnouncementIngestionService,
    CatalogService,
    CalendarService,
    AdminCalendarService,
    CalendarIngestionService,
    PdfOcrService,
    PdfProcessingService,
    NotificationsService,
    NotificationSchedulingService,
    NotificationWorkerService,
    InfrastructureHealthService,
    BootstrapSeedService,
    FirebasePushSender,
    AuditService,
    FirebaseAdminService,
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
    ...MONGO_REPOSITORY_PROVIDERS,
    {
      provide: "GoogleIdentityVerifier",
      useExisting: FirebaseGoogleIdentityVerifier
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
      provide: "PushSender",
      useExisting: FirebasePushSender
    }
  ]
})
export class AppModule {}

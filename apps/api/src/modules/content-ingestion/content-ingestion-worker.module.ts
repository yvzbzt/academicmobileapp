import { Module } from "@nestjs/common";
import { MongoConnectionService } from "../../database/mongo-connection.service.js";
import { AnnouncementIngestionService } from "../announcements/announcement-ingestion.service.js";
import { MongoAnnouncementRepository } from "../announcements/mongo-announcement.repository.js";
import { AdminCalendarService } from "../calendars/admin-calendar.service.js";
import { CalendarIngestionService } from "../calendars/calendar-ingestion.service.js";
import { MongoCalendarRepository } from "../calendars/mongo-calendar.repository.js";
import { MongoCatalogRepository } from "../catalog/mongo-catalog.repository.js";
import { MongoNotificationRepository } from "../notifications/mongo-notification.repository.js";
import { NotificationSchedulingService } from "../notifications/notifications.service.js";
import { MongoPdfRepository } from "../pdf/mongo-pdf.repository.js";
import { PdfOcrService } from "../pdf/pdf-ocr.service.js";
import { PdfProcessingService } from "../pdf/pdf-processing.service.js";
import { ContentIngestionWorkerService } from "./content-ingestion-worker.service.js";

@Module({
  providers: [
    ContentIngestionWorkerService,
    AnnouncementIngestionService,
    CalendarIngestionService,
    AdminCalendarService,
    PdfProcessingService,
    PdfOcrService,
    NotificationSchedulingService,
    MongoConnectionService,
    { provide: "CatalogRepository", useClass: MongoCatalogRepository },
    { provide: "CalendarRepository", useClass: MongoCalendarRepository },
    { provide: "AnnouncementRepository", useClass: MongoAnnouncementRepository },
    { provide: "PdfRepository", useClass: MongoPdfRepository },
    { provide: "NotificationRepository", useClass: MongoNotificationRepository }
  ]
})
export class ContentIngestionWorkerModule {}

import { Injectable } from "@nestjs/common";
import { applicationDefault, cert, getApps, initializeApp, type App } from "firebase-admin/app";

@Injectable()
export class FirebaseAdminService {
  getApp(): App {
    const existing = getApps()[0];
    if (existing) return existing;

    const projectId = process.env.FIREBASE_PROJECT_ID ?? process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GCLOUD_PROJECT;
    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

    if (serviceAccountJson) {
      return initializeApp({
        credential: cert(JSON.parse(serviceAccountJson)),
        ...(projectId ? { projectId } : {})
      });
    }

    if (projectId || process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.K_SERVICE) {
      return initializeApp({
        credential: applicationDefault(),
        ...(projectId ? { projectId } : {})
      });
    }

    throw new Error("FIREBASE_NOT_CONFIGURED");
  }
}

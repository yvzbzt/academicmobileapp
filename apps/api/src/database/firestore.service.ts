import { Inject, Injectable } from "@nestjs/common";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { FirebaseAdminService } from "./firebase-admin.service.js";

@Injectable()
export class FirestoreDatabaseService {
  private db?: Firestore;

  constructor(@Inject(FirebaseAdminService) private readonly firebaseAdmin: FirebaseAdminService) {}

  getDb(): Firestore {
    if (this.db) return this.db;
    const app = this.firebaseAdmin.getApp();
    this.db = getFirestore(app);
    return this.db;
  }

  async ping(): Promise<void> {
    await this.getDb().listCollections();
  }
}

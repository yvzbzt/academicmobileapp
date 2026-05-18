import { Injectable, OnApplicationShutdown } from "@nestjs/common";
import mongoose, { type Connection } from "mongoose";

@Injectable()
export class MongoConnectionService implements OnApplicationShutdown {
  private connection?: Connection;

  async connect(uri = process.env.MONGODB_URI): Promise<Connection | null> {
    if (!uri) return null;
    if (this.connection?.readyState === 1) return this.connection;
    const connection = await mongoose.createConnection(uri, {
      serverSelectionTimeoutMS: Number(process.env.MONGODB_SELECTION_TIMEOUT_MS ?? 3000)
    }).asPromise();
    this.connection = connection;
    return connection;
  }

  getConnection(): Connection | null {
    return this.connection ?? null;
  }

  async onApplicationShutdown() {
    await this.connection?.close();
  }
}

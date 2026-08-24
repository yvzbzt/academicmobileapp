import mongoose, { type Collection, type Document } from "mongoose";
import {
  isProtectedSensitiveValue,
  protectSensitiveValue,
  revealSensitiveValue,
  sensitiveLookupHash,
  validateDataProtectionEnvironment
} from "../security/data-protection.js";

interface MigrationResult {
  collection: string;
  scanned: number;
  updated: number;
}

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI?.trim();
  if (!uri) throw new Error("MONGODB_URI is required.");
  const validation = validateDataProtectionEnvironment(process.env);
  if (validation.errors.length > 0) throw new Error(`DATA_PROTECTION_INVALID: ${validation.errors.join(" ")}`);

  const connection = await mongoose.createConnection(uri, { serverSelectionTimeoutMS: 10_000 }).asPromise();
  try {
    const results = [
      await migrateUsers(connection.collection("users")),
      await migrateRefreshTokens(connection.collection("refresh_tokens")),
      await migrateAcademicSuggestions(connection.collection("academic_unit_suggestions")),
      await migrateDeviceTokens(connection.collection("device_tokens"))
    ];
    await connection.collection("users").createIndex(
      { emailLookupHash: 1 },
      { unique: true, sparse: true, name: "users_email_lookup_unique" }
    );
    await connection.collection("users").createIndex(
      { firebaseAuthUidLookupHash: 1 },
      { unique: true, sparse: true, name: "users_firebase_auth_uid_lookup" }
    );
    await connection.collection("users").createIndex(
      { appleSubjectLookupHash: 1 },
      { unique: true, sparse: true, name: "users_apple_subject_lookup" }
    );
    await connection.collection("device_tokens").createIndex(
      { tokenLookupHash: 1 },
      { unique: true, sparse: true, name: "device_tokens_token_lookup_unique" }
    );
    process.stdout.write(`${JSON.stringify({ status: "ok", results })}\n`);
  } finally {
    await connection.close();
  }
}

async function migrateUsers(collection: Collection<Document>): Promise<MigrationResult> {
  return migrateCollection(collection, async (document) => {
    const update: Record<string, string> = {};
    const fullName = stringField(document, "fullName");
    if (fullName) update.fullName = ensureProtected(fullName, "user.fullName");

    const storedEmail = stringField(document, "email");
    if (storedEmail) {
      const email = revealSensitiveValue(storedEmail, "user.email").trim().toLowerCase();
      update.email = ensureProtected(storedEmail, "user.email", email);
      update.emailLookupHash = sensitiveLookupHash(email, "user.email");
    }

    const firebaseAuthUid = stringField(document, "firebaseAuthUid");
    if (firebaseAuthUid) {
      const uid = revealSensitiveValue(firebaseAuthUid, "user.firebaseAuthUid");
      update.firebaseAuthUid = ensureProtected(firebaseAuthUid, "user.firebaseAuthUid", uid);
      update.firebaseAuthUidLookupHash = sensitiveLookupHash(uid, "user.firebaseAuthUid");
    }
    const appleSubject = stringField(document, "appleSubject");
    if (appleSubject) {
      const subject = revealSensitiveValue(appleSubject, "user.appleSubject");
      update.appleSubject = ensureProtected(appleSubject, "user.appleSubject", subject);
      update.appleSubjectLookupHash = sensitiveLookupHash(subject, "user.appleSubject");
    }
    return update;
  });
}

async function migrateRefreshTokens(collection: Collection<Document>): Promise<MigrationResult> {
  return migrateCollection(collection, async (document) => {
    const update: Record<string, string> = {};
    const ipAddress = stringField(document, "ipAddress");
    const userAgent = stringField(document, "userAgent");
    if (ipAddress) update.ipAddress = ensureProtected(ipAddress, "refreshToken.ipAddress");
    if (userAgent) update.userAgent = ensureProtected(userAgent, "refreshToken.userAgent");
    return update;
  });
}

async function migrateAcademicSuggestions(collection: Collection<Document>): Promise<MigrationResult> {
  return migrateCollection(collection, async (document) => {
    const update: Record<string, string> = {};
    const userEmail = stringField(document, "userEmail");
    const facultyName = stringField(document, "facultyName");
    const departmentName = stringField(document, "departmentName");
    if (userEmail) {
      const email = revealSensitiveValue(userEmail, "academicSuggestion.userEmail").trim().toLowerCase();
      update.userEmail = ensureProtected(userEmail, "academicSuggestion.userEmail", email);
      update.userEmailLookupHash = sensitiveLookupHash(email, "academicSuggestion.userEmail");
    }
    if (facultyName) update.facultyName = ensureProtected(facultyName, "academicSuggestion.facultyName");
    if (departmentName) update.departmentName = ensureProtected(departmentName, "academicSuggestion.departmentName");
    return update;
  });
}

async function migrateDeviceTokens(collection: Collection<Document>): Promise<MigrationResult> {
  return migrateCollection(collection, async (document) => {
    const token = stringField(document, "token");
    if (!token) return {};
    const plaintext = revealSensitiveValue(token, "deviceToken.token");
    return {
      token: ensureProtected(token, "deviceToken.token", plaintext),
      tokenLookupHash: sensitiveLookupHash(plaintext, "deviceToken.token")
    };
  });
}

async function migrateCollection(
  collection: Collection<Document>,
  transform: (document: Document) => Promise<Record<string, string>>
): Promise<MigrationResult> {
  let scanned = 0;
  let updated = 0;
  const cursor = collection.find({});
  for await (const document of cursor) {
    scanned += 1;
    const set = await transform(document);
    const rawDocument = document as unknown as Record<string, unknown>;
    const changed = Object.entries(set).some(([field, value]) => rawDocument[field] !== value);
    if (!changed) continue;
    await collection.updateOne({ _id: document._id }, { $set: set });
    updated += 1;
  }
  return { collection: collection.collectionName, scanned, updated };
}

function ensureProtected(stored: string, purpose: string, plaintext = revealSensitiveValue(stored, purpose)): string {
  return isProtectedSensitiveValue(stored) ? stored : protectSensitiveValue(plaintext, purpose);
}

function stringField(document: Document, field: string): string | undefined {
  const value = (document as unknown as Record<string, unknown>)[field];
  return typeof value === "string" && value ? value : undefined;
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

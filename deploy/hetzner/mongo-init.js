const databaseName = process.env.MONGO_APP_DATABASE;
const username = process.env.MONGO_APP_USERNAME;
const password = process.env.MONGO_APP_PASSWORD;

if (!databaseName || !username || !password) {
  throw new Error("MongoDB application user configuration is incomplete.");
}

db.getSiblingDB(databaseName).createUser({
  user: username,
  pwd: password,
  roles: [{ role: "readWrite", db: databaseName }]
});

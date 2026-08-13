import "dotenv/config";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL is not set — copy .env.example to .env and add your Supabase connection string."
  );
}

const queryClient = postgres(connectionString, { max: 10 });

export const db = drizzle(queryClient, { schema });

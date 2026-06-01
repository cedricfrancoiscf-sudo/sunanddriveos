-- Migration: add roles[] to users
ALTER TABLE "users" ADD COLUMN "roles" text[] NOT NULL DEFAULT '{}';

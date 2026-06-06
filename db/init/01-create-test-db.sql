-- Runs once on first container init (docker-entrypoint-initdb.d). Creates the
-- test database next to muster_dev so adapter tests have their own DB to wipe
-- without touching dev data (DEC-020). Migrations run separately via db/migrate.ts.
CREATE DATABASE muster_test OWNER muster;

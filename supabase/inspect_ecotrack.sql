
-- EcoTrack Backend
-- Purpose: Inspect the existing database setup.
-- This script does not modify tables, data, or policies.

-- 1. List application tables and their row-level security status.
SELECT
    schemaname,
    tablename,
    rowsecurity
FROM pg_tables
JOIN pg_class
    ON pg_class.relname = pg_tables.tablename
JOIN pg_namespace
    ON pg_namespace.oid = pg_class.relnamespace
WHERE schemaname = 'public'
  AND pg_namespace.nspname = 'public'
ORDER BY tablename;

-- 2. List primary keys, foreign keys, and unique constraints.
SELECT
    tc.table_name,
    tc.constraint_name,
    tc.constraint_type,
    kcu.column_name,
    ccu.table_name AS referenced_table,
    ccu.column_name AS referenced_column
FROM information_schema.table_constraints AS tc
LEFT JOIN information_schema.key_column_usage AS kcu
    ON tc.constraint_name = kcu.constraint_name
    AND tc.constraint_schema = kcu.constraint_schema
LEFT JOIN information_schema.constraint_column_usage AS ccu
    ON tc.constraint_name = ccu.constraint_name
    AND tc.constraint_schema = ccu.constraint_schema
WHERE tc.table_schema = 'public'
  AND tc.constraint_type IN (
      'PRIMARY KEY',
      'FOREIGN KEY',
      'UNIQUE'
  )
ORDER BY tc.table_name, tc.constraint_type, tc.constraint_name;

-- 3. List existing public-schema security policies.
SELECT
    schemaname,
    tablename,
    policyname,
    roles,
    cmd,
    qual,
    with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

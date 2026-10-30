-- Usuario de base de datos con mínimo privilegio para la aplicación en producción.
-- Las migraciones se ejecutan con el usuario dueño (por ejemplo "connor"); la aplicación se conecta como "connor_app".
-- Uso (como superusuario o dueño de la base):
--   psql "$DATABASE_URL_OWNER" -v app_password="'CONTRASEÑA_LARGA'" -f deploy/db-roles.sql
-- Vuelve a ejecutarlo después de cada migración que agregue tablas.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'connor_app') THEN
    CREATE ROLE connor_app LOGIN;
  END IF;
END $$;
ALTER ROLE connor_app PASSWORD :app_password;

SELECT format('GRANT CONNECT ON DATABASE %I TO connor_app', current_database()) \gexec
GRANT USAGE ON SCHEMA public TO connor_app;
REVOKE CREATE ON SCHEMA public FROM connor_app;

-- Lectura y escritura normal sobre todas las tablas y vistas, sin TRUNCATE ni cambios de estructura.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO connor_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO connor_app;

-- Registros que nunca debe poder borrar la aplicación (además de los disparadores que ya lo impiden):
REVOKE UPDATE, DELETE ON audit_log FROM connor_app;
REVOKE DELETE ON payments, sales, installments, lot_events FROM connor_app;
REVOKE UPDATE ON installments FROM connor_app;
REVOKE INSERT, UPDATE, DELETE ON schema_migrations FROM connor_app;

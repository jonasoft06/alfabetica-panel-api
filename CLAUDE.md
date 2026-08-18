# CLAUDE.md

Contexto para Claude Code al trabajar en `alfabetica-panel-api`, el backend del panel administrativo de Alfabética (consultoría editorial).

## Contexto del proyecto

Este backend es compartido: sirve tanto al panel administrativo (`alfabetica-panel-web`, Next.js) como, eventualmente, al sitio de marketing (`alfabetica-webapp`). No existe un `alfabetica-apirest` separado — ese repo se descartó, este es el único backend del ecosistema.

Repos relacionados (no es un monorepo, son repos separados):
- `alfabetica-webapp` — frontend de marketing, Next.js, ya en producción.
- `alfabetica-panel-web` — frontend del panel administrativo, Next.js, en scaffolding.
- `alfabetica-panel-api` (este repo) — backend compartido.

## Stack

- **Framework:** NestJS
- **Lenguaje:** TypeScript
- **Gestor de paquetes:** pnpm
- **ORM:** Prisma — elegido sobre TypeORM y Drizzle por su type safety estricto (compila en error si el código no coincide con el schema), Prisma Studio como ventana visual a los datos mientras no existe `panel-web`, y sintaxis cercana a lo que el desarrollador ya conocía de Mongoose.
- **Base de datos:** PostgreSQL vía DigitalOcean Managed Database (cluster administrado, misma región que los droplets — SFO3 — para evitar cargos de transferencia). No corre en el mismo droplet que la API.
- **Identidad/Auth:** Firebase (Google login, dominio corporativo), validado vía Firebase Admin SDK. Firebase resuelve *quién eres*; este backend resuelve *qué puedes hacer*.
- **Despliegue:** Dokku sobre DigitalOcean.

## Metodología de trabajo (importante)

El desarrollador viene de Vue 2 / TypeScript / NestJS previo, está aprendiendo Prisma desde Mongoose, y quiere mantenerse activo en el proceso, no solo revisar código generado. Por eso:

- **Discutir y aprobar estructura antes de escribir código.** No generar módulos, entidades o lógica de negocio sin que el desarrollador lo indique explícitamente.
- **Paso a paso, validando cada pieza antes de avanzar.** No construir varias cosas de golpe.
- **Explicar el porqué de las decisiones técnicas**, no solo entregar el código.
- **Si algo depende de una decisión no tomada aún** (estructura de datos, nombre de campo, flujo de negocio), preguntar antes de asumir.
- Commits en inglés, una unidad de trabajo por commit, mensajes descriptivos tipo conventional commits (ej. `chore: scaffold NestJS project with pnpm`).

## Modelo de datos — Auth + Users (diseño aprobado, en construcción)

Módulo actual en desarrollo. Orden de módulos del proyecto completo: **Auth + Users → Projects (antes "Proyectario") → Tracking + ClickUp (antes "Seguimiento") → Inventory (antes "Inventario", pausado, fase 2)**.

**Convención de nomenclatura:** todo lo que se implemente en este proyecto (modelos, tablas, campos, código, archivos) usa nombres en inglés — no español. El diseño conceptual se discutió originalmente en español (ver razonamiento abajo), pero toda su materialización en código es en inglés.

### Entidades

**`users`** (modelo `User`)
- `id`, `name`, `email` (único, dominio corporativo), `firebaseUid`/`firebase_uid` (puente hacia Firebase, nunca se guardan credenciales), `roleId`/`role_id` (FK, un solo rol por usuario), `status` (enum `active`/`inactive` — controla el acceso), `lastLogin`/`last_login`, `createdAt`/`created_at`, `updatedAt`/`updated_at`.
- Alta manual únicamente: el administrador da de alta el correo antes de que la persona pueda hacer login. No hay auto-registro.

**`roles`** (modelo `Role`)
- `id`, `name` (único), `description`, `createdAt`/`created_at`.
- Gestión libre desde el panel por el administrador (crear, renombrar).

**`permissions`** (modelo `Permission`)
- `id`, `key` (identificador técnico estable, ej. `users`, `projects`, `tracking`, `inventory`; nunca cambia, es lo que el código compara), `name` (etiqueta legible para la UI, puede cambiar libremente), `description`.
- **Catálogo fijo.** Nace únicamente vía migración/seed, acoplado al deploy del módulo de código real que representa. Nunca se crea desde una UI — ningún permiso puede existir sin su módulo ya funcionando en producción.
- Permisos son por módulo completo (sí/no), no por acción granular (no hay CRUD fino de "puede crear pero no borrar").

**`role_permissions`** (modelo `RolePermission`, tabla puente, muchos-a-muchos)
- `id`, `roleId`/`role_id` (FK), `permissionId`/`permission_id` (FK), único sobre el par.
- El administrador arma esta relación desde el panel (checkboxes de permisos existentes al crear/editar un rol) — nunca inventa permisos nuevos, solo combina los que ya existen en el catálogo.

### Flujo de autenticación

1. Login con Google vía Firebase → Firebase valida identidad, regresa `firebase_uid` + token.
2. La API verifica el token contra Firebase Admin SDK.
3. Busca en `users` por `firebaseUid`; si no existe o `status = inactive`, rechaza.
4. Si es válido, resuelve todos sus permisos vía `role_permissions` **una sola vez** y los embebe en un JWT propio.
5. Cada endpoint protegido valida contra ese JWT en memoria — sin consultar la base de datos en cada request.

### Estructura del schema de Prisma

El schema usa **multi-file schema** (nativo desde Prisma 6.7.0+, sin preview flag): `prisma.config.ts` apunta al directorio `prisma/` completo, no a un archivo único. `prisma/schema.prisma` solo contiene `generator` y `datasource`; cada módulo tiene su propio archivo (ej. `prisma/users.prisma` para Auth + Users). Este patrón se repite para cada módulo nuevo (Projects, Tracking, Inventory) según se construyan.

### Cuenta superadmin (break-glass)

Mecanismo de acceso de emergencia, deliberadamente **fuera** del modelo normal de `users`/`roles`/`permissions`:

- El `firebaseUid` del desarrollador vive en una variable de entorno (`SUPERADMIN_FIREBASE_UID`), no como fila en `users`.
- El middleware de auth lo revisa **antes** de consultar la base de datos; si coincide, otorga acceso total e incondicional, sin excepciones ni permisos acotados.
- Sobrevive cualquier corrupción del modelo normal (rol mal asignado, único admin bloqueado, etc.) porque no depende de él.
- Incluye **modo impersonar**: permite operar "como" un rol específico para reproducir con fidelidad errores de permisos reportados por otras cuentas (pasando por el mismo guard que pasaría esa cuenta real).
- Cada acción ejecutada bajo este modo debe quedar loggeada (quién, cuándo, qué operación), precisamente porque se salta el control de acceso normal.

## Convenciones de estructura (a definir/confirmar según avance el código real)

- Estructura modular por feature (router/controller, service, DTOs), inspirada en el patrón estándar de NestJS.
- Separar modelos de entrada (respuesta cruda de APIs externas como ClickUp) de los modelos de salida (la API propia), para desacoplar.
- `pnpm-lock.yaml` se versiona.

## Ambientes

Por ahora, un solo ambiente (`.env` local + variables de entorno gestionadas por Dokku en producción, sin overlap). Multi-ambiente (test) se evaluará después de la primera versión funcional del panel — no se sobre-construye esto de antemano.
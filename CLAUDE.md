# CLAUDE.md

Contexto para Claude Code al trabajar en `alfabetica-panel-api`, el backend del panel administrativo de Alfabética (consultoría editorial).

## Contexto del proyecto

Este backend es compartido: sirve tanto al panel administrativo (`alfabetica-panel-webapp`) como, eventualmente, al sitio de marketing (`alfabetica-webapp`). No existe un `alfabetica-apirest` separado — ese repo se descartó, este es el único backend del ecosistema.

Repos relacionados (no es un monorepo, son repos separados):
- `alfabetica-webapp` — frontend de marketing, Next.js, ya en producción.
- `alfabetica-panel-webapp` — frontend del panel administrativo: Next.js, TypeScript, Tailwind, shadcn/ui. Llama a esta API a través de su BFF (route handler `src/app/api/[...path]`), nunca directo desde el navegador. Sus contratos de respuesta viven en `src/contracts/*` (`@api existing` / `@api proposed`).
- `alfabetica-panel-api` (este repo) — backend compartido.

## Stack

- **Framework:** NestJS 11
- **Lenguaje:** TypeScript
- **Gestor de paquetes:** pnpm
- **ORM:** Prisma 7 (driver adapter `@prisma/adapter-pg`, cliente generado en `generated/prisma`, no versionado) — elegido sobre TypeORM y Drizzle por su type safety estricto (compila en error si el código no coincide con el schema), Prisma Studio como ventana visual a los datos, y sintaxis cercana a lo que el desarrollador ya conocía de Mongoose.
- **Base de datos:** PostgreSQL vía DigitalOcean Managed Database (cluster administrado, misma región que los droplets — SFO3 — para evitar cargos de transferencia). No corre en el mismo droplet que la API. La conexión va por TLS verificando el certificado CA del cluster, para no aceptar un servidor que se haga pasar por la base.
- **Archivos:** DigitalOcean Spaces (S3-compatible, bucket en SFO3), servidos por CDN. `infra/` documenta la configuración que vive fuera del código (por ejemplo, la bucket policy que hace públicos solo los archivos bajo `public/`); se aplica a mano, no en el deploy.
- **Identidad/Auth:** Firebase (Google login, dominio corporativo), validado vía Firebase Admin SDK. Firebase resuelve *quién eres*; este backend resuelve *qué puedes hacer*.
- **Despliegue:** Dokku sobre DigitalOcean.

### Convenciones fijas

- **Dependencias siempre en la última versión estable**, nunca canary/beta/rc.
- **Secretos en producción vía `dokku config:set`**, nunca en el repo.
- **Validación separada por responsabilidad:** Joi valida las variables de entorno al arrancar (`src/config/env.validation.ts`); class-validator valida los DTOs de cada request.

## Metodología de trabajo (importante)

El desarrollador viene de Vue 2 / TypeScript / NestJS previo, está aprendiendo Prisma desde Mongoose, y quiere mantenerse activo en el proceso, no solo revisar código generado. Por eso:

- **Discutir y aprobar el diseño antes de escribir código.** No generar módulos, entidades o lógica de negocio sin que el desarrollador lo indique explícitamente.
- **Trabajo estructural (refactors, mover módulos, cambiar rutas): primero un plan** — tabla de archivos/métodos viejo → nuevo, grafo de imports entre módulos y lista de conflictos con las reglas — y **esperar aprobación** antes de tocar nada.
- **Paso a paso, validando cada pieza antes de avanzar.** No construir varias cosas de golpe.
- **Cada cambio se valida manualmente en Yaak antes de hacer commit.** Al terminar una tarea, entregar los casos de prueba de Yaak (incluyendo errores: 400/403/404/409).
- **Explicar el porqué de las decisiones técnicas**, no solo entregar el código.
- **Si algo depende de una decisión no tomada aún** (estructura de datos, nombre de campo, flujo de negocio), preguntar antes de asumir.
- Commits en inglés, una unidad de trabajo por commit, mensajes descriptivos tipo conventional commits (ej. `chore: scaffold NestJS project with pnpm`).

## Estado de los módulos

Orden del proyecto completo y estado actual:

1. **Auth + Users** — hecho: login, refresh, logout, `GET /users/me`. Hoy el único usuario (el primer administrador) nace del seed.
2. **Projects (core)** — hecho: CRUD, creación con facetas en una sola transacción, soft delete.
3. **Portfolio** — hecho: faceta 1:1, portada, galería, publicar/despublicar con límite `SiteSettings.portfolioMaxItems`, listado `GET /portfolios`.
4. **Publication** — hecho: faceta 1:1 con tipos `SALE` / `LINK` / `DOI` (cambio de tipo con cascada), portada, galería, listado `GET /publications`, y **secciones** (solo DOI) con PDF por sección.
5. **Media** — hecho: Spaces, subida directa con URL prefirmada (`PUT`), ciclo `PENDING` → `CONFIRMED`, limpieza de pendientes, URLs públicas por CDN.
6. **ActivityLog** — hecho: toda escritura registra una entrada (actor, acción, entidad, proyecto, metadata) en la misma transacción, y las facetas guardan `updatedById`.
7. **Production + ClickUp** (antes "Seguimiento") — hecho: faceta 1:1 con `publicCode` aleatorio, vínculo a una lista de ClickUp y sincronización **solo de lectura** (individual al vincular, masiva con `POST /productions/sync`). La etapa de ClickUp se traduce a una fase del catálogo `ProductionPhase` por número de etapa y tipo de libro (`production/utils/phase-mapping.ts`). Pendiente: ruta pública de seguimiento.
8. **Inventory / Product** (antes "Inventario") — **diferido** (fase 2). Solo existe el permiso en el catálogo; no hay schema. La futura tienda se planea como `Product` + `ProductVariant`, unificando los libros que hoy son publicaciones `SALE`; por eso los campos comerciales de `Publication` (`price`, `quantity`, `sku`, `compareAtPrice`) son **transitorios**.
9. **Gestión de colaboradores** — mínima hecha: listar usuarios/roles/permisos, invitar (`POST /users/invitations`) y activar/desactivar (`PATCH /users/:id/status`). Pendiente: editar permisos, reenviar invitaciones, correo de invitación.

**Convención de nomenclatura:** todo lo que se implemente en este proyecto (modelos, tablas, campos, código, archivos) usa nombres en inglés — no español. El diseño conceptual se discute en español, pero toda su materialización en código es en inglés.

## Modelo de datos — Auth + Users

### Entidades

**`users`** (modelo `User`)
- `id`, `name`, `email` (único, dominio corporativo), `firebaseUid`/`firebase_uid` (puente hacia Firebase, nulo hasta el primer login; nunca se guardan credenciales), `roleId`/`role_id` (opcional), `status` (enum `INVITED` / `ACTIVE` / `INACTIVE`), `invitedAt`, `invitationExpiresAt` (nulo = no expira), `invitedById`, `lastLogin`, `tokenVersion` (revocación de sesiones), `createdAt`, `updatedAt`.
- Alta por invitación únicamente: el administrador crea la fila con el correo (`INVITED`) antes de que la persona pueda hacer login. No hay auto-registro. El único paso de `INVITED` a `ACTIVE` es el primer login, que además enlaza el `firebaseUid`.

**`roles`** (modelo `Role`)
- `id`, `name` (único), `description`, `createdAt`.
- **Es solo una etiqueta de equipo; la autorización es por usuario (`user_permissions`).** Etiquetas del seed: `administrator`, `editorial`, `design`, `sales`. **No otorga ningún permiso** y nunca se usa para autorizar; viaja en el JWT solo para mostrarse. No existe `role_permissions`.

**`permissions`** (modelo `Permission`)
- `id`, `key` (identificador técnico estable que compara el código; nunca cambia), `name` (etiqueta legible para la UI), `description`.
- **Catálogo fijo.** Nace únicamente vía seed/migración, acoplado al deploy del módulo real que representa. Nunca se crea desde una UI.
- Keys actuales (seed): `users`, `projects`, `portfolio`, `publication`, `production`, `settings`, `inventory`.
- Permisos por módulo completo (sí/no), no por acción granular.

**`user_permissions`** (modelo `UserPermission`, tabla puente usuario ↔ permiso)
- `id`, `userId`, `permissionId`, `createdAt`, único sobre el par. Cascade al borrar usuario o permiso.
- **Los permisos se asignan por usuario**, combinando permisos existentes del catálogo. El seed le otorga el catálogo completo al primer administrador.

### Reglas de autorización

- Todas las rutas del panel requieren sesión (`AccessTokenGuard` + `PermissionsGuard`).
- **Lecturas (GET): cualquier sesión válida**, sin importar permisos.
- **Escrituras: `@RequirePermissions('<key>')`** del módulo dueño (semántica AND si se listan varios). Agregar o quitar una faceta es `projects`; editar el contenido de la faceta es `portfolio` / `publication`.
- Media se autoriza por el `scope` del archivo (`PORTFOLIO` → `portfolio`, `PUBLICATION` → `publication`), resuelto en el servicio porque el scope viene del body o de la fila.

### Flujo de autenticación

1. Login con Google vía Firebase en el frontend → el BFF manda el **Firebase ID token** a `POST /auth/login`.
2. `FirebaseAuthGuard` verifica el token con Firebase Admin SDK.
3. La API valida dominio permitido (`ALLOWED_EMAIL_DOMAIN`) y `email_verified`; busca al usuario por `firebaseUid` (debe estar `ACTIVE`) o, en el primer login, por correo (debe estar `INVITED` y no expirado) y lo enlaza y activa.
4. Emite dos tokens propios:
   - **Access token** (JWT de vida corta, `JWT_ACCESS_EXPIRES_IN`) con `sub`, `email`, `role` y la lista de `permissions`, resueltos **una sola vez**. Se envía en `Authorization: Bearer`. Cada endpoint protegido valida contra él en memoria, sin consultar la base de datos.
   - **Refresh token** (JWT de vida larga, `JWT_REFRESH_EXPIRES_IN`) con `sub` + `tokenVersion`, en cookie `refreshToken` httpOnly, `sameSite=lax`, `secure` en producción.
5. `POST /auth/refresh` relee al usuario de la base (estado y permisos actuales) y rechaza si `tokenVersion` no coincide.
6. `POST /auth/logout` incrementa `tokenVersion`: revoca todas las sesiones del usuario, en todos los dispositivos.
7. Los rechazos de login/refresh devuelven 403 con un `code` estable (`EMAIL_NOT_VERIFIED`, `USER_NOT_INVITED`, `INVITATION_EXPIRED`, `USER_INACTIVE`, `ACCOUNT_CONFLICT`) que el frontend usa para elegir pantalla — renombrarlos rompe el panel.

### Cuenta superadmin (break-glass) — diseñada, NO implementada

**Hoy no existe en el código.** Lo único construido es la validación de la variable `SUPERADMIN_FIREBASE_UID` (obligatoria en producción); ningún guard la lee. El endpoint `POST /media/cleanup-pending` usa el permiso `settings` como sustituto temporal hasta que exista.

Diseño aprobado para cuando se construya — deliberadamente **fuera** del modelo normal de `users`/`permissions`:

- El `firebaseUid` del desarrollador vive en `SUPERADMIN_FIREBASE_UID`, no como fila en `users`.
- El middleware de auth lo revisa **antes** de consultar la base de datos; si coincide, otorga acceso total e incondicional.
- Sobrevive cualquier corrupción del modelo normal (permisos mal asignados, único admin bloqueado, etc.) porque no depende de él.
- Incluye **modo impersonar**: operar "como" un usuario/conjunto de permisos para reproducir errores de permisos, pasando por el mismo guard que la cuenta real.
- Cada acción ejecutada bajo este modo debe quedar loggeada (quién, cuándo, qué operación).

## Estructura del código

### Un módulo por faceta

```
src/
  common/        archivos planos (NO es un módulo Nest): project-existence.util
                 (findActiveOrFail), project-detail.util, slug.util, DTOs compartidos
  projects/      ProjectsModule — raíz del agregado: core, crear con facetas, soft delete
  portfolios/    PortfoliosModule — faceta portfolio + GET /portfolios
  publications/  PublicationsModule — faceta publication + GET /publications
    sections/    secciones DOI y su PDF
  production/    ProductionModule — faceta production + GET /productions, sync con ClickUp
                 (un solo ProductionController: patrón objetivo, ver Rutas)
  media/         MediaModule — media de proyecto, galería, limpieza
    covers/      CoverService: reglas de portada compartidas (cada faceta pasa su config)
  integrations/
    clickup/     ClickUpModule — cliente de solo lectura; tipos crudos de ClickUp solo aquí
  storage/       StorageModule — cliente de Spaces, URLs prefirmadas y públicas
  activity-log/  logActivity (se llama dentro de la transacción de cada escritura)
  auth/, users/, firebase/, prisma/, config/
```

- **Las dependencias apuntan en un solo sentido:** `Projects → Portfolios / Publications / Production → Media → Storage`, y `Production → ClickUp`.
- **Las facetas nunca importan `ProjectsModule`.** Usan `common/` para lo que comparten con el proyecto.
- Las operaciones del proyecto que tocan facetas (crear con facetas, soft delete) siguen siendo atómicas: las facetas exportan métodos `...InTx(tx, …)` (`createInTx`, `cleanupForProjectDeleteInTx`) que `ProjectsService` llama dentro de **su** transacción.
- **Sin `forwardRef`.** Si aparece un ciclo, se detiene el trabajo y se rediseña.
- Cada módulo: controller(s), service, `dto/`. DTOs que usan varios módulos van a `common/`, salvo que pertenezcan a un servicio concreto (ej. DTOs de portada en `media/covers/dto/`).
- Separar modelos de entrada (respuesta cruda de APIs externas como ClickUp) de los modelos de salida (la API propia), para desacoplar.
- Orden de escritura: primero la base de datos (en transacción), después Spaces (borrado silencioso tras el commit; un huérfano en Spaces es inofensivo).

### Rutas

- **Cada controller declara la URL real** (sin `RouterModule`), para que la ruta sea visible en cada handler.
- **Patrón objetivo: un solo controller por faceta**, carpeta y archivos en singular, con `@Controller()` y la ruta completa en cada método; sirve tanto el sub-recurso bajo el proyecto como el listado plano y sus acciones. `production/production.controller.ts` ya lo sigue (`/projects/:projectId/production`, `/productions`, `/productions/sync`, `/production-phases`). Portfolios y publications todavía tienen dos controllers (`portfolio.controller` + `portfolios.controller`, etc.) y se migrarán a este patrón más adelante — no mezclar ese cambio con otro trabajo.
- **Facetas 1:1 = sub-recurso singular bajo el proyecto:** `/projects/:projectId/portfolio`, `/projects/:projectId/publication` (y su `/cover`, `/publish`, …).
- **Anidamiento poco profundo:** las acciones de colección van bajo el padre (`GET|POST /projects/:projectId/publication/sections`, `PUT …/sections/order`); las acciones de miembro van planas por su propio id (`/media/:id/...`, `/sections/:sectionId/...`).
- Listados planos por recurso: `GET /portfolios`, `GET /publications`.
- **Respuesta de las acciones de faceta:** `PATCH …/cover/confirm`, `POST …/portfolio/publish` y `POST …/portfolio/unpublish` devuelven `ProjectDetailDto` (legado, se mantiene por el contrato del webapp — no cambiarlo sin aprobación). Los endpoints de faceta nuevos devuelven la faceta, igual que los `PUT`.
- Nombres de recurso de una sola palabra, sin guiones cuando sea posible. Excepción justificada: `GET /production-phases` (`/phases` sería ambiguo y `/productions/phases` chocaría con un futuro `/productions/:id`).
- **Ninguna ruta pública (sin autenticación) bajo las rutas del panel.** El prefijo para rutas públicas (sitio de marketing) se decidirá cuando se construyan.

### Convenciones de respuesta

- **Media solo se serializa con `toMediaItem` / `toCoverItem`** (`media/media-item.mapper.ts`), y las URLs públicas solo salen del helper de storage. Nunca se exponen `storageKey` ni el `status` del media.
- **Los listados embeben la portada y resuelven los conteos en un número fijo de queries** (sin N+1). Los conteos (`counts`) se calculan sobre el conjunto completo, ignorando los filtros del query, para que las tarjetas de resumen no cambien al filtrar.
- **Los campos Decimal se serializan como string** (`Prisma.Decimal`, sin ceros a la derecha: `385.00` → `"385"`); el frontend los formatea.
- **Los query DTOs rechazan parámetros desconocidos** (`ValidationPipe` global con `forbidNonWhitelisted` → 400).
- **Errores de endpoints nuevos: `{ statusCode, code, message }`** (como auth), con `code` estable y mensaje genérico; nunca se reenvían cuerpos de error de servicios externos (se registran en el log del servidor). Los endpoints existentes que responden `{ reason }` se quedan así hasta un refactor planeado del manejo de errores.

### Prisma

- **Multi-file schema** (nativo desde Prisma 6.7.0+): `prisma.config.ts` apunta al directorio `prisma/` completo. `prisma/schema.prisma` solo contiene `generator` y `datasource`; cada módulo tiene su archivo (`users.prisma`, `project.prisma`, `portfolio.prisma`, `publication.prisma`, `project-media.prisma`, `activity-log.prisma`, `site-settings.prisma`, `production.prisma`).
- **Siempre `pnpm exec prisma …`**, nunca `npx` ni `pnpm dlx`.
- En Prisma 7, `migrate dev` **no** corre `generate` ni el seed por sí solo: después de migrar, ejecutar explícitamente `pnpm exec prisma generate` y, si aplica, `pnpm exec prisma db seed` (el seed es `tsx prisma/seed.ts`, configurado en `prisma.config.ts`).
- El seed es idempotente (upserts): catálogo de permisos, etiquetas de rol, fases de producción, la fila única de `SiteSettings` y el primer administrador (`SEED_ADMIN_EMAIL`, `SEED_ADMIN_NAME`) en estado `INVITED` con todos los permisos.
- `pnpm-lock.yaml` se versiona.

## Ambientes

Un solo cluster de PostgreSQL (DigitalOcean) con tres bases separadas; cuál usa cada proceso lo deciden las variables de entorno:

- **`alfabetica_test`** — desarrollo local (`DATABASE_URL` del `.env` local).
- **`alfabetica_shadow`** — `SHADOW_DATABASE_URL`, solo para que `prisma migrate dev` detecte drift; la app nunca la usa.
- **`alfabetica_prod`** — producción (`DATABASE_URL` gestionada en Dokku).

`.env` local y variables de Dokku en producción, sin overlap. `.env.example` lista los nombres de todas las variables (sin valores) y `src/config/env.validation.ts` (Joi) las valida al arrancar. Credenciales y cadenas de conexión nunca van en el repo ni en este archivo.

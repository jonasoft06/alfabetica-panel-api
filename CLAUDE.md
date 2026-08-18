# CLAUDE.md

Contexto para Claude Code al trabajar en `alfabetica-panel-api`, el backend del panel administrativo de Alfabética (consultoría editorial).

## Contexto del proyecto

Este backend es compartido: sirve tanto al panel administrativo (`alfabetica-panel-web`, Next.js) como, eventualmente, al sitio de marketing (`alfabetica-webapp`).

Repos relacionados (no es un monorepo, son repos separados):
- `alfabetica-webapp` — frontend de marketing, Next.js, ya en producción.
- `alfabetica-panel-web` — frontend del panel administrativo, Next.js, en scaffolding.
- `alfabetica-panel-api` (este repo) — backend compartido.

## Stack

- **Framework:** NestJS
- **Lenguaje:** TypeScript
- **Gestor de paquetes:** pnpm
- **ORM:** Prisma — Prisma Studio como ventana visual a los datos mientras no existe `panel-web`, y sintaxis cercana a lo que el desarrollador ya conocía de Mongoose.
- **Base de datos:** PostgreSQL, autoalojado vía Dokku (`dokku-postgres`) en un droplet de DigitalOcean dedicado a este backend + BD.
- **Identidad/Auth:** Firebase (Google login, dominio corporativo), validado vía Firebase Admin SDK. Firebase resuelve *quién eres*; este backend resuelve *qué puedes hacer*.
- **Despliegue:** Dokku sobre DigitalOcean.

## Metodología de trabajo (importante)

El desarrollador viene de Vue 2 / TypeScript / NestJS previo, está aprendiendo Prisma desde Mongoose, y quiere mantenerse activo en el proceso, no solo revisar código generado. Por eso:

- **Discutir y aprobar estructura antes de escribir código.** No generar módulos, entidades o lógica de negocio sin que el desarrollador lo indique explícitamente.
- **Paso a paso, validando cada pieza antes de avanzar.** No construir varias cosas de golpe.
- **Si algo depende de una decisión no tomada aún** (estructura de datos, nombre de campo, flujo de negocio), preguntar antes de asumir.
- Commits en inglés, una unidad de trabajo por commit, mensajes descriptivos tipo conventional commits (ej. `chore: scaffold NestJS project with pnpm`).

## Modelo de datos — Auth + Usuarios (diseño aprobado, en construcción)

Módulo actual en desarrollo. Orden de módulos del proyecto completo: **Auth + Usuarios → Proyectario → Seguimiento + ClickUp → Inventario (pausado, fase 2)**.

### Entidades

**`usuarios`**
- `id`, `nombre`, `correo` (único, dominio corporativo), `firebase_uid` (puente hacia Firebase, nunca se guardan credenciales), `rol_id` (FK, un solo rol por usuario), `estado` (activo/inactivo — controla el acceso), `ultimo_acceso`, `fecha_creacion`, `fecha_actualizacion`.
- Alta manual únicamente: el administrador da de alta el correo antes de que la persona pueda hacer login. No hay auto-registro.

**`roles`**
- `id`, `nombre`, `descripcion`, `fecha_creacion`.
- Gestión libre desde el panel por el administrador (crear, renombrar).

**`permisos`**
- `id`, `clave` (identificador técnico estable, ej. `proyectario`, `seguimiento`, `usuarios`, `inventario`; nunca cambia, es lo que el código compara), `nombre` (etiqueta legible para la UI, puede cambiar libremente), `descripcion`.
- **Catálogo fijo.** Nace únicamente vía migración/seed, acoplado al deploy del módulo de código real que representa. Nunca se crea desde una UI — ningún permiso puede existir sin su módulo ya funcionando en producción.
- Permisos son por módulo completo (sí/no), no por acción granular (no hay CRUD fino de "puede crear pero no borrar").

**`rol_permisos`** (tabla puente, muchos-a-muchos)
- `id`, `rol_id` (FK), `permiso_id` (FK), único sobre el par (`rol_id`, `permiso_id`).
- El administrador arma esta relación desde el panel (checkboxes de permisos existentes al crear/editar un rol) — nunca inventa permisos nuevos, solo combina los que ya existen en el catálogo.

### Flujo de autenticación

1. Login con Google vía Firebase → Firebase valida identidad, regresa `firebase_uid` + token.
2. La API verifica el token contra Firebase Admin SDK.
3. Busca en `usuarios` por `firebase_uid`; si no existe o `estado = inactivo`, rechaza.
4. Si es válido, resuelve todos sus permisos vía `rol_permisos` **una sola vez** y los embebe en un JWT propio.
5. Cada endpoint protegido valida contra ese JWT en memoria — sin consultar la base de datos en cada request.

### Cuenta superadmin (break-glass)

Mecanismo de acceso de emergencia, deliberadamente **fuera** del modelo normal de `usuarios`/`roles`/`permisos`:

- El `firebase_uid` del desarrollador vive en una variable de entorno (`SUPERADMIN_FIREBASE_UID`), no como fila en `usuarios`.
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
import "dotenv/config";
import { PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });

const prisma = new PrismaClient({ adapter });

const permissionsCatalog = [
  {
    key: "users",
    name: "Users",
    description: "Collaborators, invitations and permissions",
  },
  {
    key: "projects",
    name: "Projects",
    description: "Project core data and module relations",
  },
  {
    key: "portfolio",
    name: "Portfolio",
    description: "Portfolio content, cover, gallery and web publishing",
  },
  {
    key: "production",
    name: "Production",
    description: "Production tracking and ClickUp sync",
  },
  {
    key: "publication",
    name: "Publication",
    description: "Sales, links and DOI chapter publishing",
  },
  {
    key: "settings",
    name: "Settings",
    description: "Global site configuration",
  },
  {
    key: "inventory",
    name: "Inventory",
    description: "Inventory management (phase 2)",
  },
];

const roleLabels = [
  { name: "administrator", description: "Panel administration and oversight" },
  { name: "editorial", description: "Editorial review and content work" },
  { name: "design", description: "Design and layout work" },
  { name: "sales", description: "Sales and commercial follow-up" },
];

async function main() {
  // 1. Permission catalog — fixed, only ever born here.
  const permissions: { id: string; key: string }[] = [];
  for (const permission of permissionsCatalog) {
    permissions.push(
      await prisma.permission.upsert({
        where: { key: permission.key },
        update: { name: permission.name, description: permission.description },
        create: permission,
      }),
    );
  }
  console.log(`Permissions upserted: ${permissions.length}`);

  // 2. Role labels — team labels only, they grant nothing.
  const roles = new Map<string, string>();
  for (const role of roleLabels) {
    const saved = await prisma.role.upsert({
      where: { name: role.name },
      update: { description: role.description },
      create: role,
    });
    roles.set(saved.name, saved.id);
  }
  console.log(`Roles upserted: ${roles.size}`);

  // 3. Single site settings row, on schema defaults.
  const existingSettings = await prisma.siteSettings.findFirst();
  if (!existingSettings) {
    await prisma.siteSettings.create({ data: {} });
    console.log("Site settings row created");
  }

  // 4. First admin user — invited, never auto-activated.
  // Same normalization the login flow applies, so the invited row can actually
  // be matched when the admin signs in with Google.
  const adminEmail = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  if (!adminEmail) {
    throw new Error(
      "SEED_ADMIN_EMAIL is required to seed the first admin user. Set it in your environment and run the seed again.",
    );
  }
  const adminName = process.env.SEED_ADMIN_NAME ?? null;

  const existingAdmin = await prisma.user.findUnique({
    where: { email: adminEmail },
  });

  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {
      // Never overwrite status, firebaseUid or an already set name.
      name: existingAdmin?.name ?? adminName,
      roleId: roles.get("administrator") ?? null,
    },
    create: {
      email: adminEmail,
      name: adminName,
      firebaseUid: null,
      status: "INVITED",
      roleId: roles.get("administrator") ?? null,
      invitedAt: new Date(),
      invitationExpiresAt: null,
    },
  });
  console.log(`Admin user upserted: ${admin.email}`);

  // 5. Grant the whole catalog to the first admin.
  for (const permission of permissions) {
    await prisma.userPermission.upsert({
      where: {
        userId_permissionId: {
          userId: admin.id,
          permissionId: permission.id,
        },
      },
      update: {},
      create: { userId: admin.id, permissionId: permission.id },
    });
  }
  console.log(`Admin permissions granted: ${permissions.length}`);

  console.log("Seed completed");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

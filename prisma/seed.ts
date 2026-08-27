import { PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });

const prisma = new PrismaClient({ adapter });

async function main() {
  const adminRole = await prisma.role.upsert({
    where: { name: "administrator" },
    update: {},
    create: {
      name: "administrator",
      description: "Full access to all panel modules",
    },
  });

  // Rename tracking -> production on the existing row (not a new key),
  // so the existing role_permissions link is preserved instead of orphaned.
  const trackingPermission = await prisma.permission.findUnique({
    where: { key: "tracking" },
  });

  if (trackingPermission) {
    await prisma.permission.update({
      where: { id: trackingPermission.id },
      data: {
        key: "production",
        name: "Production",
        description: "Production tracking and ClickUp sync",
      },
    });
    console.log("Renamed permission: tracking -> production");
  }

  const permissionsCatalog = [
    { key: "users", name: "Users", description: "Account and role administration" },
    { key: "projects", name: "Projects", description: "Book, portfolio and public catalog management" },
    { key: "production", name: "Production", description: "Production tracking and ClickUp sync" },
    { key: "publication", name: "Publication", description: "Sales, links and DOI chapter publishing" },
    { key: "settings", name: "Settings", description: "Global site configuration" },
    { key: "inventory", name: "Inventory", description: "Inventory management (phase 2)" },
  ];

  for (const permission of permissionsCatalog) {
    const registered = await prisma.permission.upsert({
      where: { key: permission.key },
      update: { name: permission.name, description: permission.description },
      create: permission,
    });

    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: adminRole.id,
          permissionId: registered.id,
        },
      },
      update: {},
      create: {
        roleId: adminRole.id,
        permissionId: registered.id,
      },
    });
  }

  console.log("Seed completed: administrator role + permissions catalog + role_permissions");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
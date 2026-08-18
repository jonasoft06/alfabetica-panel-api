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

  const permissionsCatalog = [
    { key: "users", name: "Users", description: "Account and role administration" },
    { key: "projects", name: "Projects", description: "Book management and editorial lifecycle" },
    { key: "tracking", name: "Tracking", description: "Progress tracking and ClickUp sync" },
    { key: "inventory", name: "Inventory", description: "Inventory management (phase 2)" },
  ];

  for (const permission of permissionsCatalog) {
    const registered = await prisma.permission.upsert({
      where: { key: permission.key },
      update: {},
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

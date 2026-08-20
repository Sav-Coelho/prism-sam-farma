import { PrismaClient } from '@prisma/client'
import { TRANSFER_GROUP } from './dre'

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({ log: ['error'] })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

/**
 * Única conta semeada no boot: 9.9.01 — Transferência entre Contas (NEUTRO).
 * Nunca entra nos totais da DRE; usada para mover dinheiro entre contas próprias.
 */
async function seedTransferAccount() {
  try {
    await prisma.account.upsert({
      where: { code: '9.9.01' },
      update: {},
      create: {
        code: '9.9.01',
        name: 'Transferência entre Contas',
        type: 'NEUTRO',
        dreGroup: TRANSFER_GROUP,
        active: true,
      },
    })
  } catch {
    // non-fatal — banco pode não estar acessível no build
  }
}

seedTransferAccount()

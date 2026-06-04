import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const devices = await prisma.devices.findMany({
    where: { is_active: true },
    orderBy: { created_at: 'asc' },
    select: {
      id: true,
      device_name: true,
      location: true,
      is_active: true,
    },
  })
  return NextResponse.json({ data: devices })
}

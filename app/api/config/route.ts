import { NextResponse } from 'next/server'
import { getPublicConfig } from '@/lib/sensor'

export function GET() {
  return NextResponse.json(getPublicConfig())
}

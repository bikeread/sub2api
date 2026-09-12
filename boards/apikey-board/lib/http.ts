import { NextResponse } from 'next/server';

export function jsonOk<T>(data: T) {
  return NextResponse.json({
    ok: true,
    data,
  });
}

export function jsonError(status: number, message: string) {
  return NextResponse.json(
    {
      ok: false,
      error: message,
    },
    { status },
  );
}

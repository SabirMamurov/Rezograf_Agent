import { NextRequest, NextResponse } from "next/server";
import { generateBarcodeSvg } from "@/lib/barcodes";

// GET /api/barcode?code=4600000000001
export async function GET(req: NextRequest) {
  const code = new URL(req.url).searchParams.get("code");
  if (!code) {
    return NextResponse.json({ error: "Missing 'code' parameter" }, { status: 400 });
  }

  try {
    const svg = await generateBarcodeSvg(code);
    return new NextResponse(svg, {
      headers: { "Content-Type": "image/svg+xml" },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Barcode generation failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { generateBarcodeSvg } from "@/lib/barcodes";

// GET /api/barcode?code=4600000000001[&separateText=1]
//   separateText=1 — return bars-only SVG (no embedded digits). The
//   consumer is expected to render the digits as ordinary HTML below for
//   better thermal-print wear resistance. Used by labels in the «Тест»
//   folder; rolled out broadly only after warehouse scan validation.
export async function GET(req: NextRequest) {
  const params = new URL(req.url).searchParams;
  const code = params.get("code");
  const separateText = params.get("separateText") === "1";
  if (!code) {
    return NextResponse.json({ error: "Missing 'code' parameter" }, { status: 400 });
  }

  try {
    const svg = await generateBarcodeSvg(code, { separateText });
    return new NextResponse(svg, {
      headers: { "Content-Type": "image/svg+xml" },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Barcode generation failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

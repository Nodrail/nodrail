import { openApiDocument } from "@/server/public-api/openapi";

export function GET() {
  return Response.json(openApiDocument());
}

import type { IncomingMessage, ServerResponse } from "node:http";
import { createContext, handleRequest, type ServerContext } from "../src/server.ts";

let context: ServerContext | undefined;

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const host = req.headers.host ?? "localhost";
  const request = new Request(`https://${host}${req.url}`, {
    method: req.method,
    headers: req.headers as HeadersInit,
    body: req.method === "GET" || req.method === "HEAD" ? undefined : new Uint8Array(Buffer.concat(chunks)),
  });
  context ??= createContext();
  const response = await handleRequest(request, context);
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  res.writeHead(response.status, headers);
  res.end(Buffer.from(await response.arrayBuffer()));
}

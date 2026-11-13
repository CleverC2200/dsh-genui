declare module 'node:http' {
  export interface IncomingMessage {
    method?: string
    url?: string
  }
  export interface ServerResponse {
    writeHead(statusCode: number, headers?: Record<string, string>): ServerResponse
    end(data?: string | Buffer): void
  }
}

declare module 'node:fs/promises' {
  export function readFile(path: string): Promise<Buffer>
}

declare module 'node:path' {
  export function join(...paths: string[]): string
}

declare module 'node:url' {
  export function fileURLToPath(url: URL): string
}

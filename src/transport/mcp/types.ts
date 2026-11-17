export type JsonRpcRequest = {jsonrpc: '2.0'; id: number; method: string; params?: unknown};
export type JsonRpcNotification = {jsonrpc: '2.0'; method: string; params?: unknown};
export type JsonRpcResponse = {
    jsonrpc: '2.0';
    id: number;
    result?: unknown;
    error?: {code: number; message: string; data?: unknown};
};

export type McpContentPart = {
    type: string;
    text?: string;
    data?: string;
    mimeType?: string;
};

export type McpResult =
    | {
          isError?: boolean;
          content?: McpContentPart[];
      }
    | null
    | undefined;

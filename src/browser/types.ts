export type Viewport = {
    width: number;
    height: number;
};

export type StartSessionParams = {
    headless?: boolean;
    storageStatePath?: string;
    viewport?: Viewport;
    videoDir?: string;
    targetUrl?: string;
};

export type SnapshotResult = {
    snapshot: string;
    hasDialog: boolean;
};

export function createMapSpec(): import("../../src/client/spec.js").GenuiSpec;
export function mapBrowserLaunchOptions(executablePath: any): {
    headless: boolean;
    chromiumSandbox: boolean;
    ignoreDefaultArgs: string[];
    args: string[];
    executablePath: any;
} | {
    headless: boolean;
    chromiumSandbox: boolean;
    ignoreDefaultArgs: string[];
    args: string[];
    channel: string;
};
export function validateMapMode({ map, smoke, sidechat, install, env, uid }: {
    map: any;
    smoke: any;
    sidechat: any;
    install: any;
    env: any;
    uid: any;
}): void;
export function safeMapError(error: any): string;
export function recordMapCheckFailure(failures: any, stage: any, check: any): Promise<boolean>;
export function assertMapChecksPassed(failures: any): void;
export function measureRoutePixels({ data, width, height }: {
    data: any;
    width: any;
    height: any;
}): {
    width: any;
    height: any;
    route: number;
    background: number;
    longest: number;
    pass: boolean;
};
export function assertOfflineMapArtifact(artifact: any): any;
export const MAP_TITLE: "Map browser locations";
export const MAP_ACTION: "map-confirm";
export const MAP_SUBMIT: "Submit map selection";

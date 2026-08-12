declare module 'node:path' {
  const path: any;
  export default path;
}

declare module 'node:child_process' {
  export const spawnSync: any;
}

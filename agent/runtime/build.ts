// Filled in by scripts/build-agent.mjs; source runs (tests, dev) report "dev".
declare const __RESUME_BUILD__: { version: string; commit: string } | undefined;
export const buildInfo: { version: string; commit: string } =
  typeof __RESUME_BUILD__ === 'undefined' ? { version: 'dev', commit: '' } : __RESUME_BUILD__;
export const buildLabel = (build: { version: string; commit: string } = buildInfo) =>
  build.commit ? `${build.version} (${build.commit})` : build.version;

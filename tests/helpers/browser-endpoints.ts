function port(value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 1024 || parsed > 65535)
    throw new Error("Browser test ports must be integers from 1024 to 65535.");
  return parsed;
}

export const testApiPort = port(process.env.AUTOPILOT_E2E_API_PORT, 14317);
export const testWebPort = port(process.env.AUTOPILOT_E2E_WEB_PORT, 14318);
export const testMobileApiPort = port(process.env.AUTOPILOT_E2E_MOBILE_API_PORT, 14319);
export const testMobileWebPort = port(process.env.AUTOPILOT_E2E_MOBILE_WEB_PORT, 14320);
if (new Set([testApiPort, testWebPort, testMobileApiPort, testMobileWebPort]).size !== 4)
  throw new Error("All browser test API and web ports must differ.");
export const testOrigin = `http://127.0.0.1:${testWebPort}`;
export const testMobileOrigin = `http://127.0.0.1:${testMobileWebPort}`;

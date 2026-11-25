import { testDatabase } from "../tests/support/local-stack";

export const appTestDatabase = () => testDatabase("nodrail_e2e");
export const clientIpHeader = "x-nodrail-e2e-client-ip";

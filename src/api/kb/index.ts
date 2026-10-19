import { createApiLog, logExchange, withApiLog, type ApiLog } from "./apiLog";
import { createHttpKbApi, type KbApi } from "./client";
import { KB_API_BASE_URL, KB_API_TOKEN, PROJECT_CODE, getApiMode } from "./config";
import { createMockKbApi } from "./mock";

// Fixed for this page load; the switch in the editor stores a new mode and reloads.
export const apiMode = getApiMode();
export const usingMockApi = apiMode === "mock";

const log = createApiLog();

// Every call, mock or live, is recorded here (shown in the API log tab).
export const apiLog: ApiLog = log;

export const kbApi: KbApi = usingMockApi
  ? withApiLog(createMockKbApi(), log, "kb mock")
  : createHttpKbApi({
      baseUrl: KB_API_BASE_URL,
      token: KB_API_TOKEN,
      projectCode: PROJECT_CODE,
      onExchange: (exchange) => logExchange(log, "kb live", exchange),
    });

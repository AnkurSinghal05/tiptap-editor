import { createApiLog, withApiLog, type ApiLog } from "./apiLog";
import { createHttpKbApi, type KbApi } from "./client";
import { KB_API_BASE_URL, KB_API_TOKEN, PROJECT_CODE } from "./config";
import { createMockKbApi } from "./mock";

export const usingMockApi = !KB_API_BASE_URL;

const mockLog = usingMockApi ? createApiLog() : null;

// Calls to the mock backend are recorded here (shown in the API log tab).
export const apiLog: ApiLog | null = mockLog;

// Real backend when VITE_KB_API_BASE_URL is set, otherwise the in-memory mock.
export const kbApi: KbApi = mockLog
  ? withApiLog(createMockKbApi(), mockLog, "kb mock")
  : createHttpKbApi({ baseUrl: KB_API_BASE_URL!, token: KB_API_TOKEN, projectCode: PROJECT_CODE });

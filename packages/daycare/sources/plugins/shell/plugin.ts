import { z } from "zod";

import { definePlugin } from "../../engine/plugins/types.js";
import {
  buildExecTool,
  buildWorkspaceEditTool,
  buildWorkspaceReadTool,
  buildWorkspaceWriteTool
} from "./tool.js";
import {
  buildProcessListTool,
  buildProcessLogsTool,
  buildProcessStartTool,
  buildProcessStopAllTool,
  buildProcessStopTool
} from "./processTools.js";
import { Processes } from "./processes.js";

const settingsSchema = z.object({}).passthrough();

export const plugin = definePlugin({
  settingsSchema,
  create: (api) => {
    const processes = new Processes(api.dataDir, api.logger);
    return {
      load: async () => {
        await processes.load();
        api.registrar.registerTool(buildWorkspaceReadTool());
        api.registrar.registerTool(buildWorkspaceWriteTool());
        api.registrar.registerTool(buildWorkspaceEditTool());
        api.registrar.registerTool(buildExecTool());
        api.registrar.registerTool(buildProcessStartTool(processes));
        api.registrar.registerTool(buildProcessListTool(processes));
        api.registrar.registerTool(buildProcessStopTool(processes));
        api.registrar.registerTool(buildProcessStopAllTool(processes));
        api.registrar.registerTool(buildProcessLogsTool(processes));
      },
      unload: async () => {
        api.registrar.unregisterTool("read");
        api.registrar.unregisterTool("write");
        api.registrar.unregisterTool("edit");
        api.registrar.unregisterTool("exec");
        api.registrar.unregisterTool("process_start");
        api.registrar.unregisterTool("process_list");
        api.registrar.unregisterTool("process_stop");
        api.registrar.unregisterTool("process_stop_all");
        api.registrar.unregisterTool("process_logs");
        processes.unload();
      }
    };
  }
});

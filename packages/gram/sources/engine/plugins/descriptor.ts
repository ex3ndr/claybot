import { z } from "zod";

export const pluginDescriptorSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  entry: z.string().min(1)
});

export type PluginDescriptor = z.infer<typeof pluginDescriptorSchema>;

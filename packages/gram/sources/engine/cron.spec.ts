import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

import { CronScheduler, getNextCronTime, parseCronExpression } from "./cron.js";
import { CronStore } from "./cron-store.js";

describe("parseCronExpression", () => {
  it("parses wildcard expression", () => {
    const result = parseCronExpression("* * * * *");
    expect(result).not.toBeNull();
    expect(result!.minute.any).toBe(true);
    expect(result!.hour.any).toBe(true);
  });

  it("parses specific values", () => {
    const result = parseCronExpression("30 9 * * *");
    expect(result).not.toBeNull();
    expect(result!.minute.values.has(30)).toBe(true);
    expect(result!.hour.values.has(9)).toBe(true);
  });

  it("parses step values", () => {
    const result = parseCronExpression("*/15 * * * *");
    expect(result).not.toBeNull();
    expect(result!.minute.values.has(0)).toBe(true);
    expect(result!.minute.values.has(15)).toBe(true);
    expect(result!.minute.values.has(30)).toBe(true);
    expect(result!.minute.values.has(45)).toBe(true);
  });

  it("parses ranges", () => {
    const result = parseCronExpression("* 9-17 * * *");
    expect(result).not.toBeNull();
    expect(result!.hour.values.size).toBe(9);
    expect(result!.hour.values.has(9)).toBe(true);
    expect(result!.hour.values.has(17)).toBe(true);
  });

  it("parses comma-separated values", () => {
    const result = parseCronExpression("0,30 * * * *");
    expect(result).not.toBeNull();
    expect(result!.minute.values.size).toBe(2);
    expect(result!.minute.values.has(0)).toBe(true);
    expect(result!.minute.values.has(30)).toBe(true);
  });

  it("returns null for invalid expressions", () => {
    expect(parseCronExpression("invalid")).toBeNull();
    expect(parseCronExpression("* * *")).toBeNull();
    expect(parseCronExpression("60 * * * *")).toBeNull();
  });
});

describe("getNextCronTime", () => {
  it("returns next minute for every-minute schedule", () => {
    const from = new Date(2024, 0, 15, 10, 30, 45); // Local time
    const next = getNextCronTime("* * * * *", from);

    expect(next).not.toBeNull();
    expect(next!.getMinutes()).toBe(31);
    expect(next!.getSeconds()).toBe(0);
  });

  it("returns next matching hour", () => {
    const from = new Date(2024, 0, 15, 10, 30, 0); // Local time
    const next = getNextCronTime("0 12 * * *", from);

    expect(next).not.toBeNull();
    expect(next!.getHours()).toBe(12);
    expect(next!.getMinutes()).toBe(0);
  });

  it("returns next day if hour passed", () => {
    // Use local time to avoid timezone issues
    const from = new Date(2024, 0, 15, 14, 30, 0); // Jan 15, 2024, 14:30 local
    const next = getNextCronTime("0 9 * * *", from);

    expect(next).not.toBeNull();
    expect(next!.getDate()).toBe(16);
    expect(next!.getHours()).toBe(9);
  });

  it("handles weekday constraints", () => {
    // Friday Jan 19, 2024
    const from = new Date("2024-01-19T10:00:00Z");
    // Schedule for Monday (1)
    const next = getNextCronTime("0 9 * * 1", from);

    expect(next).not.toBeNull();
    expect(next!.getDay()).toBe(1); // Monday
  });

  it("returns null for invalid expression", () => {
    expect(getNextCronTime("invalid")).toBeNull();
  });
});

describe("CronScheduler", () => {
  let tempDir: string;
  let store: CronStore;

  beforeEach(async () => {
    vi.useFakeTimers();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "cron-scheduler-test-"));
    store = new CronStore(tempDir);
  });

  afterEach(async () => {
    vi.useRealTimers();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("loads and schedules tasks from store", async () => {
    await store.createTask("test-task", {
      name: "Test Task",
      schedule: "* * * * *",
      prompt: "Do something"
    });

    const onTask = vi.fn();
    const scheduler = new CronScheduler({
      store,
      onTask
    });

    await scheduler.start();

    const tasks = scheduler.listTasks();
    expect(tasks.length).toBe(1);
    expect(tasks[0]!.id).toBe("test-task");

    scheduler.stop();
  });

  it("executes task when scheduled time arrives", async () => {
    // Set current time
    const now = new Date("2024-01-15T10:30:00Z");
    vi.setSystemTime(now);

    await store.createTask("exec-test", {
      name: "Exec Test",
      schedule: "* * * * *",
      prompt: "Execute me"
    });

    const onTask = vi.fn();
    const scheduler = new CronScheduler({
      store,
      onTask
    });

    await scheduler.start();

    // Advance time to next minute
    vi.advanceTimersByTime(60 * 1000);

    expect(onTask).toHaveBeenCalledTimes(1);
    expect(onTask).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "exec-test",
        taskName: "Exec Test",
        prompt: "Execute me"
      }),
      expect.any(Object)
    );

    scheduler.stop();
  });

  it("skips disabled tasks", async () => {
    await store.createTask("disabled-task", {
      name: "Disabled Task",
      schedule: "* * * * *",
      prompt: "Should not run",
      enabled: false
    });

    const onTask = vi.fn();
    const scheduler = new CronScheduler({
      store,
      onTask
    });

    await scheduler.start();

    const tasks = scheduler.listTasks();
    expect(tasks.length).toBe(0);

    scheduler.stop();
  });

  it("reloads tasks from disk", async () => {
    const onTask = vi.fn();
    const scheduler = new CronScheduler({
      store,
      onTask
    });

    await scheduler.start();
    expect(scheduler.listTasks().length).toBe(0);

    // Add a task to disk
    await store.createTask("new-task", {
      name: "New Task",
      schedule: "* * * * *",
      prompt: "New prompt"
    });

    await scheduler.reload();
    expect(scheduler.listTasks().length).toBe(1);

    scheduler.stop();
  });

  it("provides task context", async () => {
    await store.createTask("context-test", {
      name: "Context Test",
      schedule: "0 9 * * *",
      prompt: "Test prompt"
    });

    const onTask = vi.fn();
    const scheduler = new CronScheduler({
      store,
      onTask
    });

    await scheduler.start();

    const context = scheduler.getTaskContext("context-test");
    expect(context).not.toBeNull();
    expect(context!.taskId).toBe("context-test");
    expect(context!.taskName).toBe("Context Test");
    expect(context!.prompt).toBe("Test prompt");
    expect(context!.memoryPath).toContain("MEMORY.md");
    expect(context!.filesPath).toContain("files");

    scheduler.stop();
  });

  it("handles task execution errors", async () => {
    vi.setSystemTime(new Date("2024-01-15T10:30:00Z"));

    await store.createTask("error-task", {
      name: "Error Task",
      schedule: "* * * * *",
      prompt: "Will fail"
    });

    const onError = vi.fn();
    const scheduler = new CronScheduler({
      store,
      onTask: () => {
        throw new Error("Task failed");
      },
      onError
    });

    await scheduler.start();
    vi.advanceTimersByTime(60 * 1000);

    expect(onError).toHaveBeenCalledWith(
      expect.any(Error),
      "error-task"
    );

    scheduler.stop();
  });
});

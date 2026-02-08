# Shell Plugin

The shell plugin provides workspace file tools (`read`, `write`, `edit`), one-shot command execution (`exec`), and durable process management tools.

## Durable Process Tools

- `process_start`: starts a sandboxed detached process and persists metadata under plugin data dir.
- `process_list`: shows current process status (`running`, `stopped`, `exited`) and metadata.
- `process_stop`: stops one managed process by id.
- `process_stop_all`: stops all managed processes.
- `process_logs`: returns the absolute process log filename for use with `read`.

## Persistence Layout

Each managed process gets a folder under `<plugin-data-dir>/processes/<process-id>/`:

- `record.json`: durable process metadata (pid, restart policy, state).
- `sandbox.json`: sandbox runtime config used for launch/restart.
- `process.log`: combined stdout/stderr stream.

## Lifecycle Notes

- Processes are spawned detached, so they survive engine restarts.
- On plugin load, records are rehydrated from disk and running pids are picked up.
- On plugin load, persisted pids are cleared when the current host boot time differs from the recorded boot time.
- If `keepAlive` is true and desired state is `running`, exited processes are restarted by a monitor loop with exponential backoff.
- `process_stop` and `process_stop_all` set desired state to `stopped` and terminate process groups.

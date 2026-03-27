# Phase 05: Task System

## Goal

Turn actions into managed tasks that can be queued, started, completed, failed and inspected.

## Implemented scope

- `src/taskManager.js` added
- queue with priorities
- `created`, `running`, `completed`, `failed`, `cancelled` lifecycle
- current task persisted into state storage
- first task types:
  - `go_to`
  - `return_home`
  - `collect_wood`
- chat commands for task visibility and manual queueing
- retry and cooldown logic for failed tasks
- autonomous `collect_wood` planning when wood goal is not met

## Validation target

Confirm on the local server:

- bot accepts `go_to` as a queued task
- bot returns home through the task queue
- bot can queue `collect_wood`
- task status changes are reflected in `data/state.json`
